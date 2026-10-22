# codex-cu-bridge: install notes for agents

Follow `INSTALL.md` in this repository. Short version: on a Mac that has the ChatGPT desktop app's Computer Use plugin installed, register a stdio MCP server named `codex-cu` whose command is `node` and whose only argument is the absolute path to `bridge.mjs` from a clone of this repo (or command `npx` with arguments `-y github:nradawg/codex-cu-bridge`), then run `node bridge.mjs doctor` and confirm the client lists the tools `js` and `js_reset`.

```json
{ "mcpServers": { "codex-cu": { "command": "node", "args": ["/absolute/path/to/codex-cu-bridge/bridge.mjs"] } } }
```
