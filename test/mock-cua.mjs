// Stand-in for the ChatGPT app's cua_repl server, used by bridge.test.mjs.
// Logs every message it receives (one JSON per line) to MOCK_LOG.
import fs from "node:fs";

const LOG = process.env.MOCK_LOG;
const WARMUP_DELAY = Number(process.env.MOCK_WARMUP_DELAY || 0);
const out = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const text = (id, t) => out({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: t }] } });
let nextId = 1;
const waiting = new Map();

function ask(method, params) {
  const id = nextId++;
  out({ jsonrpc: "2.0", id, method, params });
  return new Promise((r) => waiting.set(id, r));
}

async function onMessage(m) {
  if (LOG) fs.appendFileSync(LOG, JSON.stringify(m) + "\n");
  if (m.method == null) return waiting.get(m.id)?.(m);
  if (m.id == null) return;
  if (m.method === "initialize") {
    return out({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock", version: "0" } } });
  }
  if (m.method === "tools/list") {
    const tools = ["js", "js_reset", "turn_ended", "secret_tool"].map((name) => ({ name, description: `${name} docs`, inputSchema: { type: "object" } }));
    return out({ jsonrpc: "2.0", id: m.id, result: { tools } });
  }
  if (m.method !== "tools/call") return out({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "nope" } });
  const { name, arguments: args = {} } = m.params;
  if (name !== "js") return text(m.id, `${name} ok`);
  const code = args.code ?? "";
  if (code === "await cua.getState();") return setTimeout(() => text(m.id, "warm"), WARMUP_DELAY);
  if (code === "echo") return text(m.id, JSON.stringify({ id: m.id, params: m.params }));
  if (code === "slow") return setTimeout(() => text(m.id, "late"), 300);
  if (code.startsWith("app:")) {
    const r = await ask("elicitation/create", { message: `Allow Computer Use to use "${code.slice(4)}"?`, requestedSchema: { type: "object", properties: {} } });
    return text(m.id, r.result?.action ?? "none");
  }
  if (code === "roots") {
    const r = await ask("roots/list", {});
    return text(m.id, JSON.stringify(r));
  }
  text(m.id, "?");
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (line.trim()) onMessage(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
