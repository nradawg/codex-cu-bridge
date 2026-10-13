// End-to-end check: talk to bridge.mjs like Claude Code would, drive Calculator.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const p = spawn("node", [path.join(here, "../bridge.mjs")], { env: process.env, stdio: ["pipe", "pipe", "inherit"] });
let buf = "", id = 0; const pending = new Map();
p.stdout.on("data", d => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; const m = JSON.parse(l); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } });
const rpc = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n"); });
const text = m => (m.result?.content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n") || JSON.stringify(m.error ?? m.result);
await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const tools = await rpc("tools/list", {});
console.log("TOOLS:", tools.result.tools.map(t => t.name).join(", "));
for (const code of process.argv.slice(2)) {
  const r = await rpc("tools/call", { name: "js", arguments: { code, title: "e2e" } });
  console.log("\n=== CALL:", code, "\n" + text(r).slice(0, Number(process.env.MAXOUT || 4000)));
}
p.stdin.end(); setTimeout(() => process.exit(0), 2500);
