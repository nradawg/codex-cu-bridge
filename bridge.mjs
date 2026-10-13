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

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const PLUGIN_ROOT = path.join(CODEX_HOME, "plugins/cache/openai-bundled/unified-computer-use");
const CONFIG_DIR = path.join(os.homedir(), ".config/codex-cu-bridge");
const ALLOW_FILE = path.join(CONFIG_DIR, "allow.json");
const META_KEY = "x-codex-turn-metadata";
const EXPOSED_TOOLS = new Set(["js", "js_reset"]);
const IDLE_TURN_MS = Number(process.env.CODEX_CU_IDLE_TURN_MS) || 3 * 60 * 1000;
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
  return new Set([...fromEnv, ...fromFile].map((s) => s.toLowerCase()));
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

  const SESSION_ID = randomUUID();
  let turnId = randomUUID();
  let turnUsed = false;
  let idleTimer = null;
  let shuttingDown = false;
  let internalId = 0;
  const pendingCalls = new Set();
  const toolsListIds = new Set();
  const approvedThisSession = new Set();
  const allowlist = loadAllowlist();

  const endTurn = () => {
    if (!turnUsed) return;
    send(server.stdin, {
      jsonrpc: "2.0",
      id: `bridge-${internalId++}`,
      method: "tools/call",
      params: { name: "turn_ended", arguments: { hook_event_name: "Stop", session_id: SESSION_ID, turn_id: turnId } },
    });
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
    if (app && (approvedThisSession.has(app) || allowlist.has(app.toLowerCase()))) {
      approvedThisSession.add(app);
      log(`allowed (allowlist): ${app}`);
      return reply(msg.id, true);
    }
    if (!NATIVE_PROMPTS) {
      log(`declined (no prompt available): ${prompt}`);
      return reply(msg.id, false);
    }
    const choice = await askUser(prompt || "Allow this action?");
    log(`prompt "${prompt}" -> ${choice}`);
    if (choice === "Deny") return reply(msg.id, false);
    if (app) approvedThisSession.add(app);
    if (choice === "Always Allow" && app) persistAllow(app);
    reply(msg.id, true, choice === "Always Allow");
  }

  // client -> server
  lineReader(process.stdin, (msg) => {
    if (msg.method === "initialize") {
      const caps = (msg.params ??= {}).capabilities ?? {};
      msg.params.capabilities = { ...caps, elicitation: { ...(caps.elicitation ?? {}), form: {} } };
    } else if (msg.method === "tools/list") {
      toolsListIds.add(msg.id);
    } else if (msg.method === "tools/call") {
      const params = (msg.params ??= {});
      params._meta = { ...params._meta, [META_KEY]: { session_id: SESSION_ID, turn_id: turnId } };
      turnUsed = true;
      pendingCalls.add(msg.id);
      clearTimeout(idleTimer);
    }
    send(server.stdin, msg);
  });
  process.stdin.on("end", () => shutdown());

  // server -> client
  lineReader(server.stdout, (msg) => {
    if (msg.method === "elicitation/create" && "id" in msg) return void handleElicitation(msg);
    const isResponse = msg.method == null;
    if (isResponse && typeof msg.id === "string" && msg.id.startsWith("bridge-")) return;
    if (isResponse && toolsListIds.delete(msg.id) && Array.isArray(msg.result?.tools)) {
      msg.result.tools = msg.result.tools.filter((t) => EXPOSED_TOOLS.has(t.name));
    }
    if (isResponse && pendingCalls.delete(msg.id) && pendingCalls.size === 0) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(endTurn, IDLE_TURN_MS);
      idleTimer.unref();
    }
    send(process.stdout, msg);
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

if (process.argv[2] === "doctor") {
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
} else {
  main();
}
