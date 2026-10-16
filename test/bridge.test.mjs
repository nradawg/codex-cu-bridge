// Protocol tests for bridge.mjs against a mock cua_repl. Runs anywhere (no Mac needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startBridge({ env = {}, allowFile } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cu-bridge-"));
  const pluginDir = path.join(root, "codex/plugins/cache/openai-bundled/unified-computer-use/1.0.0");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, ".mcp.json"),
    JSON.stringify({ mcpServers: { cua_repl: { command: process.execPath, args: [path.join(here, "mock-cua.mjs")] } } }),
  );
  if (allowFile) {
    fs.mkdirSync(path.join(root, ".config/codex-cu-bridge"), { recursive: true });
    fs.writeFileSync(path.join(root, ".config/codex-cu-bridge/allow.json"), JSON.stringify({ apps: allowFile }));
  }
  const logFile = path.join(root, "server.log");
  const p = spawn(process.execPath, [path.join(here, "../bridge.mjs")], {
    env: {
      PATH: process.env.PATH, HOME: root, CODEX_HOME: path.join(root, "codex"), MOCK_LOG: logFile,
      CODEX_CU_WARMUP: "0", CODEX_CU_NATIVE_PROMPTS: "0", ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const responses = new Map();
  const waiters = new Map();
  const fromBridge = [];
  let onRequest = null;
  let buf = "";
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      fromBridge.push(m);
      if (m.method && m.id != null) onRequest?.(m);
      else if (m.method == null) {
        const k = JSON.stringify(m.id);
        if (waiters.has(k)) waiters.get(k)(m), waiters.delete(k);
        else responses.set(k, m);
      }
    }
  });
  p.stderr.resume();
  const write = (m) => p.stdin.write(JSON.stringify(m) + "\n");
  let auto = 1000;
  const c = {
    p, write, fromBridge,
    onRequest: (fn) => (onRequest = fn),
    request(method, params, id = auto++) {
      write({ jsonrpc: "2.0", id, method, params });
      return c.response(id);
    },
    response(id) {
      const k = JSON.stringify(id);
      if (responses.has(k)) return Promise.resolve(responses.get(k));
      return new Promise((r) => waiters.set(k, r));
    },
    notify: (method, params) => write({ jsonrpc: "2.0", method, params }),
    serverLog: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : []),
    async init() {
      await c.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
      c.notify("notifications/initialized");
    },
    js: (code, extra = {}, id) => c.request("tools/call", { name: "js", arguments: { code, ...extra } }, id),
    textOf: (r) => r.result?.content?.[0]?.text,
    async close() {
      p.stdin.end();
      await new Promise((r) => (p.exitCode != null ? r() : p.on("exit", r)));
    },
  };
  return c;
}

test("only js and js_reset are listed, with the cheat sheet on js", async () => {
  const c = startBridge();
  await c.init();
  const r = await c.request("tools/list", {});
  assert.deepEqual(r.result.tools.map((t) => t.name), ["js", "js_reset"]);
  assert.match(r.result.tools[0].description, /^Quick start/);
  await c.close();
});

test("hidden tools are rejected and never reach the server", async () => {
  const c = startBridge();
  await c.init();
  for (const name of ["turn_ended", "secret_tool"]) {
    const r = await c.request("tools/call", { name, arguments: {} });
    assert.equal(r.error?.code, -32602);
  }
  await c.close();
  assert.ok(!c.serverLog().some((m) => m.method === "tools/call"));
});

test("js calls get turn metadata and the default 90s timeout", async () => {
  const c = startBridge();
  await c.init();
  const seen = JSON.parse(c.textOf(await c.js("echo")));
  assert.equal(seen.params.arguments.timeout_ms, 90000);
  assert.ok(seen.params._meta["x-codex-turn-metadata"].session_id);
  assert.ok(seen.params._meta["x-codex-turn-metadata"].turn_id);
  const custom = JSON.parse(c.textOf(await c.js("echo", { timeout_ms: 5000 })));
  assert.equal(custom.params.arguments.timeout_ms, 5000);
  await c.close();
});

test("client ids are isolated from bridge ids, including look-alikes", async () => {
  const c = startBridge();
  await c.init();
  const ids = ["bridge-0", 1, "1", 0, "cua-1"];
  const results = await Promise.all(ids.map((id) => c.js("echo", {}, id)));
  results.forEach((r, i) => assert.deepEqual(r.id, ids[i]));
  const serverIds = results.map((r) => JSON.parse(c.textOf(r)).id);
  assert.equal(new Set(serverIds).size, ids.length);
  await c.close();
});

test("warm-up runs in the background and never delays client calls", async () => {
  const c = startBridge({ env: { CODEX_CU_WARMUP: "1", MOCK_WARMUP_DELAY: "3000" } });
  await c.init();
  const t0 = Date.now();
  await c.js("echo");
  assert.ok(Date.now() - t0 < 1500, `client call waited ${Date.now() - t0}ms`);
  await sleep(3300);
  await c.close();
  const calls = c.serverLog().filter((m) => m.method === "tools/call").map((m) => m.params.name);
  assert.ok(!calls.includes("js_reset"), "must not reset the REPL after the client has used it");
});

test("warm-up resets the REPL when the client has not used it yet", async () => {
  const c = startBridge({ env: { CODEX_CU_WARMUP: "1" } });
  await c.init();
  await sleep(400);
  await c.close();
  const calls = c.serverLog().filter((m) => m.method === "tools/call").map((m) => m.params.name);
  assert.deepEqual(calls.slice(0, 2), ["js", "js_reset"]);
});

test("internal warm-up responses never leak to the client", async () => {
  const c = startBridge({ env: { CODEX_CU_WARMUP: "1" } });
  await c.init();
  await sleep(400);
  await c.close();
  assert.ok(!c.fromBridge.some((m) => m.method == null && m.id !== 1000));
});

test("nothing is approved by default", async () => {
  const c = startBridge();
  await c.init();
  assert.equal(c.textOf(await c.js("app:Calculator")), "decline");
  await c.close();
});

test("CODEX_CU_ALLOW approves listed apps but never sensitive ones", async () => {
  const c = startBridge({ env: { CODEX_CU_ALLOW: "Calculator, Mail, Venmo" } });
  await c.init();
  assert.equal(c.textOf(await c.js("app:Calculator")), "accept");
  assert.equal(c.textOf(await c.js("app:Mail")), "decline");
  assert.equal(c.textOf(await c.js("app:Venmo")), "decline");
  assert.equal(c.textOf(await c.js("app:Notes")), "decline");
  await c.close();
});

test("allow.json cannot silently approve sensitive apps", async () => {
  const c = startBridge({ allowFile: ["Notes", "Messages", "1Password"] });
  await c.init();
  assert.equal(c.textOf(await c.js("app:Notes")), "accept");
  assert.equal(c.textOf(await c.js("app:Messages")), "decline");
  assert.equal(c.textOf(await c.js("app:1Password")), "decline");
  await c.close();
});

test("cancellation is remapped and the late response is dropped", async () => {
  const c = startBridge();
  await c.init();
  c.write({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "js", arguments: { code: "slow" } } });
  await sleep(50);
  c.notify("notifications/cancelled", { requestId: 7 });
  c.notify("notifications/cancelled", { requestId: 999 });
  await sleep(600);
  await c.close();
  const log = c.serverLog();
  const call = log.find((m) => m.params?.arguments?.code === "slow");
  const cancels = log.filter((m) => m.method === "notifications/cancelled");
  assert.equal(cancels.length, 1, "unknown cancellation must be dropped");
  assert.equal(cancels[0].params.requestId, call.id);
  assert.ok(!c.fromBridge.some((m) => m.id === 7), "late response after cancel must not reach the client");
});

test("server-initiated requests are remapped both ways", async () => {
  const c = startBridge();
  await c.init();
  let seenId;
  c.onRequest((m) => {
    seenId = m.id;
    c.write({ jsonrpc: "2.0", id: m.id, result: { roots: [{ uri: "file:///x" }] } });
  });
  const r = JSON.parse(c.textOf(await c.js("roots")));
  assert.match(String(seenId), /^cua-/);
  assert.deepEqual(r.result.roots, [{ uri: "file:///x" }]);
  assert.equal(typeof r.id, "number", "server must get its own id back");
  await c.close();
});

test("stray client responses are dropped", async () => {
  const c = startBridge();
  await c.init();
  c.write({ jsonrpc: "2.0", id: "cua-42", result: {} });
  c.write({ jsonrpc: "2.0", id: 5, result: {} });
  await c.js("echo");
  await c.close();
  assert.ok(!c.serverLog().some((m) => m.method == null));
});

test("turn_ended is sent on exit after the client used a tool", async () => {
  const c = startBridge();
  await c.init();
  await c.js("echo");
  await c.close();
  const ended = c.serverLog().find((m) => m.params?.name === "turn_ended");
  assert.ok(ended);
  assert.equal(ended.params.arguments.hook_event_name, "Stop");
});

test("doctor reports an empty allowlist by default", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cu-doc-"));
  const pluginDir = path.join(root, "codex/plugins/cache/openai-bundled/unified-computer-use/1.0.0");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, ".mcp.json"), JSON.stringify({ mcpServers: { cua_repl: { command: process.execPath } } }));
  const out = await new Promise((resolve) => {
    const d = spawn(process.execPath, [path.join(here, "../bridge.mjs"), "doctor"], {
      env: { PATH: process.env.PATH, HOME: root, CODEX_HOME: path.join(root, "codex") },
    });
    let s = "";
    d.stdout.on("data", (x) => (s += x));
    d.on("exit", (code) => resolve({ s, code }));
  });
  assert.equal(out.code, 0);
  assert.match(out.s, /every app asks first/);
});
