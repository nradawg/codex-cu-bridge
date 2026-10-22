# codex-cu-bridge

A stdio MCP server (`bridge.mjs`, plain Node, no dependencies) that exposes the Computer Use engine shipped with the ChatGPT desktop app to any MCP client, plus the `/mac` skill in `skills/mac/`.

- Installing it for a user: follow `INSTALL.md`.
- Working on the code: `npm test` runs the protocol tests against `test/mock-cua.mjs` and needs no ChatGPT app; `node bridge.mjs doctor --live` and `node test/e2e.mjs` need a real, unlocked Mac with Computer Use installed.
- Keep `bridge.mjs` dependency-free and runnable on Node 18; keep the skill's `name` equal to its directory name (`mac`); nothing is pre-approved by default and the always-ask app list is not configurable.
