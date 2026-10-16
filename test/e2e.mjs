// End-to-end check on a real Mac: talk to bridge.mjs like Claude Code would.
// Usage: node test/e2e.mjs 'let app = await cua.getApp("Calculator");' ...
// Exits 1 if anything errors or a step takes longer than E2E_TIMEOUT_MS (default 120s).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const LIMIT = Number(process.env.E2E_TIMEOUT_MS || 120000);
const p = spawn("node", [path.join(here, "../bridge.mjs")], { env: process.env, stdio: ["pipe", "pipe", "inherit"] });
let buf = "", id = 0, done = false, failed = false; const pending = new Map();
p.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; const m = JSON.parse(l); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } });
p.on("exit", code => { if (!done) { console.error(`FAIL: bridge exited early (code ${code})`); process.exit(1); } });
const rpc = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n"); });
const step = (what, promise) => {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${LIMIT}ms`)), LIMIT); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};
const text = m => (m.result?.content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n") || JSON.stringify(m.error ?? m.result);
try {
  await step("initialize", rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } }));
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const tools = await step("tools/list", rpc("tools/list", {}));
  const names = (tools.result?.tools ?? []).map(t => t.name);
  console.log("TOOLS:", names.join(", "));
  if (!names.includes("js")) throw new Error("js tool missing");
  for (const code of process.argv.slice(2)) {
    const r = await step(code, rpc("tools/call", { name: "js", arguments: { code, title: "e2e" } }));
    console.log("\n=== CALL:", code, "\n" + text(r).slice(0, Number(process.env.MAXOUT || 4000)));
    if (r.error || r.result?.isError) failed = true;
  }
} catch (e) {
  console.error("FAIL:", e.message);
  failed = true;
}
done = true;
p.stdin.end();
setTimeout(() => process.exit(failed ? 1 : 0), 2500);
