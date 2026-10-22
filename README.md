# codex-cu-bridge

Turn the **Codex Computer Use** engine inside the ChatGPT desktop app into an MCP server **any agent can use**: Claude Code, Hermes, OpenClaw, Claude Desktop, Cursor, Goose, or anything else that can launch a stdio MCP server.

Your agent does the thinking; Codex's helper does the clicking and typing in your Mac apps. No OpenAI API calls, no extra keys, no OpenAI code in this repo - it launches the copy already on your Mac.

## How it works

1. Turning on Computer Use in the ChatGPT app installs a hidden MCP server (`cua_repl`) under `~/.codex/plugins/cache/openai-bundled/unified-computer-use/`. Only Codex is meant to talk to it.
2. `bridge.mjs` is a plain stdio MCP server. It starts `cua_repl` and relays messages, so any MCP client can use it. It exposes two tools, `js` and `js_reset`, and prepends a quick-start cheat sheet to the `js` description so an agent can act on its first call.
3. It adds the three things Codex normally supplies and other clients don't:
   - **turn metadata** (`x-codex-turn-metadata`) on every call - browser control fails without it
   - **app consent** - apps in your allowlist are approved silently; anything else pops a native macOS *Allow / Always Allow / Deny* dialog, titled with your client's name. Nothing is approved by default.
   - **turn cleanup** (`turn_ended`) after 3 min idle and on exit, so Chrome tabs get released

## Requirements

- macOS, ChatGPT desktop app with **Codex → Computer Use turned on and used once**
- Accessibility + Screen Recording granted to *Codex Computer Use*
- Node 18+
- Any MCP client that can run a stdio server. (Codex CLI and the ChatGPT app already have this engine natively; the bridge is for everyone else.)

## Install

```bash
git clone https://github.com/nradawg/codex-cu-bridge.git && cd codex-cu-bridge && ./install.sh
```

`install.sh` checks that Computer Use is installed, registers the bridge with every supported client CLI it finds on your PATH (Claude Code, Hermes, OpenClaw), and prints the config for everything else. `./install.sh claude`, `./install.sh hermes` or `./install.sh openclaw` registers one client; `./install.sh print` only prints. Restart the client afterwards.

For any client, the server is:

```json
{ "mcpServers": { "codex-cu": { "command": "node", "args": ["/absolute/path/to/codex-cu-bridge/bridge.mjs"] } } }
```

### Client notes

**Claude Code** - `./install.sh claude` runs `claude mcp add -s user codex-cu -- node "$PWD/bridge.mjs"`. For zero friction: `cp -r docs/skill ~/.claude/skills/mac` (adds `/mac`), add `docs/CLAUDE-snippet.md` to `~/.claude/CLAUDE.md`, and add `"mcp__codex-cu__js"` and `"mcp__codex-cu__js_reset"` to `permissions.allow` in `~/.claude/settings.json`.

**Hermes Agent** - `./install.sh hermes` runs `hermes mcp add codex-cu --command node --args "$PWD/bridge.mjs"` and answers Y to enable both tools. Skill: `hermes skills install https://raw.githubusercontent.com/nradawg/codex-cu-bridge/main/docs/skill/SKILL.md --yes`. `hermes mcp test codex-cu` should connect and list `js` and `js_reset`. Hermes also ships its own `computer_use` tool; this one drives the ChatGPT app's engine instead.

**OpenClaw** - `./install.sh openclaw` runs `openclaw mcp add codex-cu --command node --arg "$PWD/bridge.mjs"`, which probes the server before saving.

**Claude Desktop, Cursor, Windsurf, Cline and other JSON-configured clients** - add the JSON above to the client's MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json`, `~/.cursor/mcp.json`, ...).

**Goose** - add an extension to `~/.config/goose/config.yaml`:

```yaml
extensions:
  codex-cu:
    enabled: true
    type: stdio
    name: codex-cu
    cmd: node
    args: ["/absolute/path/to/codex-cu-bridge/bridge.mjs"]
    timeout: 300
```

### Teach the agent when to use it

`docs/skill/SKILL.md` is a standard agent skill (`/mac`): first call `cua.getApp`, act, verify on screen, never route around a declined dialog. Install it wherever your client keeps skills (`~/.claude/skills/mac/` for Claude Code, `hermes skills install ...` for Hermes). For clients without skills, paste `docs/CLAUDE-snippet.md` into their system instructions.

## App approvals

- **Default:** nothing is pre-approved. The first time the agent touches an app you get a native Allow / Always Allow / Deny dialog, titled with the name your client sends in the MCP handshake. Always Allow saves the app to `~/.config/codex-cu-bridge/allow.json`.
- **Always asks, never remembered:** Mail, Messages, password apps, Keychain, Terminal, System Settings, Wallet, anything bank/Venmo/PayPal/Coinbase. These can't be allowlisted by any setting.
- **Skip the dialog for apps you trust:** set `CODEX_CU_ALLOW="Calculator,Notes,Reminders"` in the `env` of the `codex-cu` entry in your client's MCP config (`claude mcp add -e`, `hermes mcp add --env`, `openclaw mcp add --env`), or click Always Allow once.
- `CODEX_CU_NATIVE_PROMPTS=0` turns off dialogs; anything not allowlisted is then declined.

## Speed

- Warms the Computer Use service in the background on startup so the first real call doesn't cold-start. It never blocks your calls; `CODEX_CU_WARMUP=0` turns it off
- `js` calls default to a 90s timeout (`CODEX_CU_TIMEOUT_MS`, or pass `timeout_ms` per call)
- A short API cheat sheet is prepended to the `js` tool description so the agent acts on its first call

## Tests

- `npm test` runs protocol tests against a mock Computer Use server (works on any OS, no ChatGPT needed): tool filtering, hidden-tool rejection, request id isolation, non-blocking warm-up, consent defaults, cancellation and server-request remapping. The three `doctor` tests are skipped while the Mac's screen is locked, because `doctor` reports a locked screen as a failure by design.
- `node test/e2e.mjs 'let app = await cua.getApp("Calculator");'` runs against the real thing on your Mac and exits 1 on any error or hang.

## Troubleshooting

Start with `node bridge.mjs doctor --live`. It checks the install, whether your Mac is locked, and whether Computer Use actually answers, and tells you what to fix.

- **`doctor` says Computer Use is not installed:** open the ChatGPT app, go to Codex, turn on Computer Use and use it once.
- **Your Mac is locked:** Computer Use can't see or click anything on a locked screen, and calls just hang ([openai/codex#26415](https://github.com/openai/codex/issues/26415)). Unlock it and retry.
- **Calls time out / e2e hangs:** quit the ChatGPT app fully, make sure `SkyComputerUseService` is gone (Activity Monitor), reopen ChatGPT, and check that *Codex Computer Use* has Accessibility and Screen & System Audio Recording in System Settings → Privacy & Security. Then rerun the e2e.
- **After a ChatGPT update:** nothing to reinstall; the bridge picks the newest installed Computer Use version each time it starts. Restart your client.

## Verified

- 2026-10-22: Hermes Agent 0.22.4 and OpenClaw 2026.6.11 register the bridge with the commands above and discover both tools (Hermes connects in about 2s). Claude Code registration via `install.sh` unchanged.
- 2026-10-13, ChatGPT Computer Use `26.1007.41230`, Claude Code 2.1.296:
  - `node test/e2e.mjs` drove Calculator through the bridge: typed `12*34=`, read back `408`
  - A headless `claude -p` session, using only the `codex-cu` tool, computed 37×91 in Calculator and reported `3367`
  - Hands-off: `claude -p "add 'buy milk' to my Reminders"` (no tool named, no permission flags) picked codex-cu itself, added exactly one reminder, 0 permission prompts
  - Harness run after warm-up: 5s end to end (was 30-60s with a cold-start timeout)

## Caveats

Unofficial and not affiliated with OpenAI or Anthropic. Depends on undocumented ChatGPT app internals, so an app update can break it. Computer Use can read everything visible in an app you allow.

## Credit

Approach adapted from [shiptomorrow/claude-codex-computer-use](https://github.com/shiptomorrow/claude-codex-computer-use) and [bcharleson/codex-cu-mcp](https://github.com/bcharleson/codex-cu-mcp) (both MIT). See also [JoshFink/codex-cu](https://github.com/JoshFink/codex-cu).
