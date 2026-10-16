#!/usr/bin/env node
// codex-cu-bridge: lets Claude Code (or any stdio MCP client) use the Codex
// Computer Use server that ships inside the ChatGPT macOS app.
//
// The ChatGPT app installs a computer-use MCP server (`cua_repl`) under
// ~/.codex/plugins/cache/openai-bundled/unified-computer-use/<version>/.mcp.json.
// This bridge launches it and relays JSON-RPC, filling in the three things
// Codex normally supplies:
//   1. Turn metadata: every tools/call gets _meta["x-codex-turn-metadata"]
//      = { session_id, turn_id } (browser control rejects calls without it).
//   2. App consent: the server asks 'Allow Computer Use to use "X"?' per app.
//      Apps in the allowlist are approved silently; anything else gets a native
//      macOS Allow / Always Allow / Deny dialog. Nothing is approved by default.
//   3. Turn lifecycle: `turn_ended` is sent after idle and on shutdown so
//      claimed Chrome tabs are released.
//
// Approach adapted from shiptomorrow/claude-codex-computer-use and
// bcharleson/codex-cu-mcp (both MIT). No OpenAI code is included.

import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const PLUGIN_ROOT = path.join(CODEX_HOME, "plugins/cache/openai-bundled/unified-computer-use");
const CONFIG_DIR = path.join(os.homedir(), ".config/codex-cu-bridge");
const ALLOW_FILE = path.join(CONFIG_DIR, "allow.json");
const META_KEY = "x-codex-turn-metadata";
const EXPOSED_TOOLS = new Set(["js", "js_reset"]);
const IDLE_TURN_MS = Number(process.env.CODEX_CU_IDLE_TURN_MS) || 3 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = Number(process.env.CODEX_CU_TIMEOUT_MS) || 90_000;
const WARMUP = process.env.CODEX_CU_WARMUP !== "0";
const WARMUP_TIMEOUT_MS = 30_000;
// How long a cancelled or timed-out request is remembered so its late response is dropped.
const GRACE_MS = 60_000;
// Apps where a mistake costs money or embarrassment: always ask, never remembered.
const ALWAYS_ASK = [
  "Mail", "Messages", "1Password", "1Password 7", "Keychain Access", "Passwords",
  "System Settings", "System Preferences", "Terminal", "iTerm2", "Wallet", "Banking",
];
const alwaysAsk = (app) =>
  ALWAYS_ASK.some((a) => a.toLowerCase() === app.toLowerCase()) || /bank|wallet|venmo|paypal|coinbase/i.test(app);

// Prepended to the js tool description so Claude can act on its first call
// instead of spending a round trip reading the full API docs.
const CHEAT_SHEET = `Quick start (Mac apps):
  let app = await cua.getApp("Reminders");   // first call: exactly this, nothing else
  await app.typeText("text"); await app.pressKey("Return"); // also "cmd+n", "Escape"
  nodeRepl.write(await app.getAXState());     // read the UI tree (numbered elements)
  await app.click(12); await app.setValue(12, "text"); // by element number from getAXState
Work on windows where they are. Pass timeout_ms for slow steps.

`;
const NATIVE_PROMPTS = process.platform === "darwin" && process.env.CODEX_CU_NATIVE_PROMPTS !== "0";
const APP_CONSENT = /^Allow Computer Use to use "(.+)"\?$/;

const log = (...a) => process.stderr.write(`[codex-cu-bridge] ${a.join(" ")}\n`);

// ---------- discovery ----------

export function findServerConfig() {
  if (!fs.existsSync(PLUGIN_ROOT)) {
    throw new Error(
      `Codex Computer Use is not installed (${PLUGIN_ROOT} missing). ` +
        "Open the ChatGPT app, go to Codex, turn on Computer Use, and use it once.",
    );
  }
  const versions = fs
    .readdirSync(PLUGIN_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const version of versions) {
    const file = path.join(PLUGIN_ROOT, version, ".mcp.json");
    try {
      const cfg = JSON.parse(fs.readFileSync(file, "utf8")).mcpServers?.cua_repl;
      if (cfg?.command) return { version, file, cfg };
    } catch {}
  }
  throw new Error(`No cua_repl entry found in ${PLUGIN_ROOT}/*/.mcp.json`);
}

// ---------- allowlist ----------

function loadAllowlist() {
  const fromEnv = (process.env.CODEX_CU_ALLOW || "").split(",").map((s) => s.trim()).filter(Boolean);
  let fromFile = [];
  try {
    fromFile = JSON.parse(fs.readFileSync(ALLOW_FILE, "utf8")).apps ?? [];
  } catch {}
  // Nothing is approved by default, and sensitive apps can never be allowlisted.
  return new Set([...fromEnv, ...fromFile].filter((a) => !alwaysAsk(a)).map((s) => s.toLowerCase()));
}

function persistAllow(app) {
  let apps = [];
  try {
    apps = JSON.parse(fs.readFileSync(ALLOW_FILE, "utf8")).apps ?? [];
  } catch {}
  if (!apps.some((a) => a.toLowerCase() === app.toLowerCase())) apps.push(app);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(ALLOW_FILE, JSON.stringify({ apps }, null, 2) + "\n");
}

// ---------- native dialog ----------

const DIALOG_SCRIPT = `ObjC.import("AppKit");
function run([text, title]) {
  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
  const alert = $.NSAlert.alloc.init;
  alert.messageText = title;
  alert.informativeText = text;
  ["Allow", "Always Allow", "Deny"].forEach((b) => alert.addButtonWithTitle(b));
  app.activateIgnoringOtherApps(true);
  return ["Allow", "Always Allow", "Deny"][Number(alert.runModal) - 1000] ?? "Deny";
}`;

function askUser(text) {
  return new Promise((resolve) => {
    const p = spawn("osascript", ["-l", "JavaScript", "-e", DIALOG_SCRIPT, text, "Claude wants to use Computer Use"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => resolve("Deny"));
    p.on("close", () => resolve(out.trim() || "Deny"));
  });
}

// ---------- line-delimited JSON-RPC ----------

function lineReader(stream, onMessage) {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {
        log(`dropping non-JSON line: ${line.slice(0, 200)}`);
      }
    }
  });
}
const send = (stream, msg) => stream.writable && stream.write(JSON.stringify(msg) + "\n");

// ---------- main ----------

function main() {
  let found;
  try {
    found = findServerConfig();
  } catch (e) {
    log(e.message);
    process.exit(1);
  }
  const { cfg } = found;
  const server = spawn(cfg.command, cfg.args ?? [], {
    env: { ...process.env, ...(cfg.env ?? {}) },
    stdio: ["pipe", "pipe", "inherit"],
  });
  server.on("error", (e) => {
    log(`failed to start cua_repl: ${e.message}`);
    process.exit(1);
  });
  server.stdin.on("error", (e) => log(`cua_repl stdin: ${e.message}`));

  const SESSION_ID = randomUUID();
  let turnId = randomUUID();
  let turnUsed = false;
  let clientCalled = false;
  let idleTimer = null;
  let shuttingDown = false;
  const pendingCalls = new Set();
  const approvedThisSession = new Set();
  const allowlist = loadAllowlist();
  const key = (id) => JSON.stringify(id);
  const later = (fn) => setTimeout(fn, GRACE_MS).unref();

  // Every request the bridge sends to cua_repl gets a fresh id from its own counter,
  // whether it came from the client or from the bridge, so ids can never collide.
  // toServer: our id -> { clientId, method, cancelled } or { internal }
  let nextServerId = 1;
  const toServer = new Map();
  const clientToServer = new Map();
  // Requests cua_repl sends to the client are remapped the same way in the other direction.
  let nextClientId = 1;
  const toClient = new Map();
  const serverToClient = new Map();

  const forget = (sid) => {
    const entry = toServer.get(sid);
    toServer.delete(sid);
    if (entry && "clientId" in entry && clientToServer.get(key(entry.clientId)) === sid) {
      clientToServer.delete(key(entry.clientId));
    }
  };

  const callMeta = (params) => ({ ...params?._meta, [META_KEY]: { session_id: SESSION_ID, turn_id: turnId } });

  // Bridge-originated calls (warm-up, turn_ended). Resolves with the response, or null on timeout.
  const internalCall = (name, args, timeoutMs) =>
    new Promise((resolve) => {
      const id = nextServerId++;
      const timer = setTimeout(() => {
        toServer.set(id, { cancelled: true });
        later(() => toServer.delete(id));
        send(server.stdin, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "timeout" } });
        resolve(null);
      }, timeoutMs);
      timer.unref();
      toServer.set(id, { internal: (m) => (clearTimeout(timer), resolve(m)) });
      send(server.stdin, {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args, _meta: callMeta() },
      });
    });

  const endTurn = () => {
    if (!turnUsed) return;
    internalCall("turn_ended", { hook_event_name: "Stop", session_id: SESSION_ID, turn_id: turnId }, 5000);
    turnId = randomUUID();
    turnUsed = false;
  };

  const reply = (id, approve, persistAlways = false) =>
    send(server.stdin, {
      jsonrpc: "2.0",
      id,
      result: approve
        ? { action: "accept", content: {}, _meta: { persist: persistAlways ? "always" : "session" } }
        : { action: "decline" },
    });

  async function handleElicitation(msg) {
    const prompt = msg.params?.message ?? "";
    const app = prompt.match(APP_CONSENT)?.[1];
    const sensitive = app && alwaysAsk(app);
    if (app && !sensitive && (approvedThisSession.has(app) || allowlist.has(app.toLowerCase()))) {
      approvedThisSession.add(app);
      log(`allowed (allowlist): ${app}`);
      return reply(msg.id, true);
    }
    if (!NATIVE_PROMPTS) {
      log(`declined (no prompt available): ${prompt}`);
      return reply(msg.id, false);
    }
    const note = sensitive ? "\n\nThis is a sensitive app, so it asks every time." : "";
    const choice = await askUser((prompt || "Allow this action?") + note);
    log(`prompt "${prompt}" -> ${choice}`);
    if (choice === "Deny") return reply(msg.id, false);
    const remember = choice === "Always Allow" && app && !sensitive;
    if (app && !sensitive) approvedThisSession.add(app);
    if (remember) persistAllow(app);
    reply(msg.id, true, remember);
  }

  // Best-effort warm-up so the first real call doesn't cold-start. It runs in the
  // background and never holds up client traffic. The REPL is reset afterwards only
  // if the client hasn't started using it, so the client's first call still gets the docs.
  async function warmUp() {
    const t0 = Date.now();
    const r = await internalCall("js", { code: "await cua.getState();", timeout_ms: WARMUP_TIMEOUT_MS }, WARMUP_TIMEOUT_MS + 5000);
    if (!r || r.error || r.result?.isError) {
      const hint = screenLocked() ? " - your Mac is locked; Computer Use can't work until it's unlocked" : "; run `node bridge.mjs doctor --live` to check";
      return log(`warm-up did not finish (${r ? "error" : "timeout"})${hint}`);
    }
    if (!clientCalled) await internalCall("js_reset", {}, 15000);
    log(`warm-up done in ${Date.now() - t0}ms`);
  }

  const errorToClient = (id, message) =>
    send(process.stdout, { jsonrpc: "2.0", id, error: { code: -32602, message } });

  function forwardRequest(msg) {
    if (msg.method === "tools/call") {
      const params = (msg.params ??= {});
      if (!EXPOSED_TOOLS.has(params.name)) return errorToClient(msg.id, `Unknown tool: ${params.name}`);
      if (params.name === "js") params.arguments = { timeout_ms: DEFAULT_TIMEOUT_MS, ...params.arguments };
      params._meta = callMeta(params);
      turnUsed = clientCalled = true;
      clearTimeout(idleTimer);
    }
    const sid = nextServerId++;
    toServer.set(sid, { clientId: msg.id, method: msg.method });
    clientToServer.set(key(msg.id), sid);
    if (msg.method === "tools/call") pendingCalls.add(sid);
    send(server.stdin, { ...msg, id: sid });
  }

  function callSettled(sid) {
    if (pendingCalls.delete(sid) && pendingCalls.size === 0) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(endTurn, IDLE_TURN_MS);
      idleTimer.unref();
    }
  }

  // client -> server
  lineReader(process.stdin, (msg) => {
    const hasId = msg.id !== undefined && msg.id !== null;
    if (msg.method && hasId) {
      if (msg.method === "initialize") {
        const caps = (msg.params ??= {}).capabilities ?? {};
        msg.params.capabilities = { ...caps, elicitation: { ...(caps.elicitation ?? {}), form: {} } };
      }
      return forwardRequest(msg);
    }
    if (msg.method) {
      if (msg.method === "notifications/cancelled") {
        const sid = clientToServer.get(key(msg.params?.requestId));
        const entry = sid && toServer.get(sid);
        if (!entry || entry.cancelled) return;
        entry.cancelled = true;
        callSettled(sid);
        later(() => forget(sid));
        return send(server.stdin, { ...msg, params: { ...msg.params, requestId: sid } });
      }
      send(server.stdin, msg);
      if (msg.method === "notifications/initialized" && WARMUP) warmUp();
      return;
    }
    // A response to a request cua_repl sent the client.
    const original = toClient.get(key(msg.id));
    if (!original) return;
    toClient.delete(key(msg.id));
    serverToClient.delete(key(original.id));
    send(server.stdin, { ...msg, id: original.id });
  });
  process.stdin.on("end", () => shutdown());

  // server -> client
  lineReader(server.stdout, (msg) => {
    const hasId = msg.id !== undefined && msg.id !== null;
    if (msg.method === "elicitation/create" && hasId) return void handleElicitation(msg);
    if (msg.method && hasId) {
      const cid = `cua-${nextClientId++}`;
      toClient.set(key(cid), { id: msg.id });
      serverToClient.set(key(msg.id), cid);
      return send(process.stdout, { ...msg, id: cid });
    }
    if (msg.method) {
      if (msg.method === "notifications/cancelled") {
        const cid = serverToClient.get(key(msg.params?.requestId));
        if (!cid) return;
        serverToClient.delete(key(msg.params.requestId));
        later(() => toClient.delete(key(cid)));
        return send(process.stdout, { ...msg, params: { ...msg.params, requestId: cid } });
      }
      return send(process.stdout, msg);
    }
    // A response to something we sent.
    const entry = toServer.get(msg.id);
    if (!entry) return log(`dropping response to unknown id ${key(msg.id)}`);
    if (entry.internal) return void (forget(msg.id), entry.internal(msg));
    if (entry.cancelled) return; // kept until the grace timer clears it
    forget(msg.id);
    callSettled(msg.id);
    if (entry.method === "tools/list" && Array.isArray(msg.result?.tools)) {
      msg.result.tools = msg.result.tools.filter((t) => EXPOSED_TOOLS.has(t.name));
      for (const t of msg.result.tools) if (t.name === "js") t.description = CHEAT_SHEET + (t.description ?? "");
    }
    send(process.stdout, { ...msg, id: entry.clientId });
  });

  server.on("exit", (code) => {
    if (!shuttingDown) log(`cua_repl exited (code ${code})`);
    process.exit(code ?? 1);
  });

  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    clearTimeout(idleTimer);
    endTurn();
    setTimeout(() => {
      server.stdin.end();
      setTimeout(() => server.kill(), 1500).unref();
    }, 300);
  }
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, shutdown);
}

// ---------- doctor ----------

// Computer Use can't see or drive apps while the Mac is locked; requests hang or fail.
function screenLocked() {
  if (process.platform !== "darwin") return false;
  try {
    const out = execFileSync("ioreg", ["-n", "Root", "-d1"], { encoding: "utf8", timeout: 3000 });
    return /"(IOConsoleLocked|CGSSessionScreenIsLocked)"\s*=\s*Yes/.test(out);
  } catch {
    return false;
  }
}

// Starts this bridge like an MCP client would and asks Computer Use to list apps.
function liveCheck(timeoutMs) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, CODEX_CU_WARMUP: "0" },
      stdio: ["pipe", "pipe", "ignore"],
    });
    const finish = (ok, detail) => {
      clearTimeout(timer);
      p.kill();
      resolve({ ok, detail });
    };
    const timer = setTimeout(() => finish(false, `no answer from Computer Use within ${timeoutMs / 1000}s`), timeoutMs);
    p.on("exit", (code) => finish(false, `bridge exited early (code ${code})`));
    lineReader(p.stdout, (m) => {
      if (m.id === 1) {
        send(p.stdin, { jsonrpc: "2.0", method: "notifications/initialized" });
        send(p.stdin, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "js", arguments: { code: "await cua.listApps();", timeout_ms: timeoutMs } } });
      } else if (m.id === 2) {
        const text = (m.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join(" ");
        if (m.error || m.result?.isError) finish(false, (m.error?.message ?? text).slice(0, 300));
        else finish(true, "Computer Use answered");
      }
    });
    send(p.stdin, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "codex-cu-bridge-doctor", version: "1" } } });
  });
}

async function doctor(live) {
  let bad = false;
  try {
    const { version, file, cfg } = findServerConfig();
    console.log(`ok  Codex Computer Use ${version}`);
    console.log(`ok  config: ${file}`);
    console.log(`${fs.existsSync(cfg.command) ? "ok " : "BAD"} server runtime: ${cfg.command}`);
    const allow = [...loadAllowlist()];
    console.log(`ok  allowlist: ${allow.length ? allow.join(", ") : "(empty - every app asks first)"}`);
  } catch (e) {
    console.log(`BAD ${e.message}`);
    process.exit(1);
  }
  if (screenLocked()) {
    console.log("BAD your Mac is locked. Unlock it; Computer Use can't work on a locked screen");
    bad = true;
  }
  if (live && !bad) {
    const r = await liveCheck(Number(process.env.CODEX_CU_DOCTOR_TIMEOUT_MS) || 45_000);
    console.log(`${r.ok ? "ok " : "BAD"} live check: ${r.detail}`);
    if (!r.ok) {
      console.log("    Fix: quit ChatGPT fully, make sure SkyComputerUseService is gone in Activity Monitor, reopen ChatGPT,");
      console.log("    and check Codex Computer Use has Accessibility + Screen & System Audio Recording in System Settings.");
      bad = true;
    }
  } else if (!live) {
    console.log("    (run `node bridge.mjs doctor --live` to also test that Computer Use answers)");
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[2] === "doctor") {
  doctor(process.argv.includes("--live"));
} else {
  main();
}
