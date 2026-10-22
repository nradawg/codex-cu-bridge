# codex-cu-bridge

Let **Claude Code**, **Hermes**, or any other MCP client control your Mac apps using the **Codex Computer Use** engine that ships inside the ChatGPT desktop app.

Your agent does the thinking; Codex's helper does the clicking and typing. No OpenAI API calls, no extra keys, no OpenAI code in this repo - it launches the copy already on your Mac.

## How it works (simple version)

1. Turning on Computer Use in the ChatGPT app installs a hidden MCP server (`cua_repl`) under `~/.codex/plugins/cache/openai-bundled/unified-computer-use/`.
2. `bridge.mjs` starts that server and passes messages between it and your MCP client. It is a plain stdio MCP server, so anything that can launch `node bridge.mjs` can use it.
3. It adds the three things Codex normally sends and other clients don't:
   - **turn metadata** (`x-codex-turn-metadata`) on every call - browser control fails without it
   - **app consent** - apps in your allowlist are approved silently; anything else pops a native macOS *Allow / Always Allow / Deny* dialog. Nothing is approved by default.
   - **turn cleanup** (`turn_ended`) after 3 min idle and on exit, so Chrome tabs get released

## Requirements

- macOS, ChatGPT desktop app with **Codex → Computer Use turned on and used once**
- Accessibility + Screen Recording granted to *Codex Computer Use*
- Node 18+
- An MCP client: Claude Code, Hermes Agent, or anything else that can run a stdio MCP server

## Install

Get the bridge on disk and check that Computer Use is installed:

```bash
git clone https://github.com/nradawg/codex-cu-bridge.git && cd codex-cu-bridge && node bridge.mjs doctor
```

Then register it with your client. The bridge exposes two tools, `js` and `js_reset`. The `js` description carries a quick-start cheat sheet, so an agent can act on its first call. `docs/skill/SKILL.md` is an optional agent skill (`/mac`) that tells the agent when to reach for it and how to verify its work.

### Claude Code

```bash
./install.sh
```

That registers the `codex-cu` server at user scope. Restart Claude Code. Check health anytime with `node bridge.mjs doctor --live`.

Optional, for zero friction:

- `cp -r docs/skill ~/.claude/skills/mac` so `/mac` works
- Add `docs/CLAUDE-snippet.md` to `~/.claude/CLAUDE.md` so Claude picks codex-cu for Mac-app tasks without being told
- Add `"mcp__codex-cu__js"` and `"mcp__codex-cu__js_reset"` to `permissions.allow` in `~/.claude/settings.json`

### Hermes Agent

```bash
hermes mcp add codex-cu --command node --args "$PWD/bridge.mjs"   # answer Y to enable both tools
hermes skills install https://raw.githubusercontent.com/nradawg/codex-cu-bridge/main/docs/skill/SKILL.md --yes
```

`hermes mcp test codex-cu` should connect and list `js` and `js_reset`. If an agent is doing the install without a terminal, pipe the answer (`printf 'Y\n' | hermes mcp add ...`) or add the server to `~/.hermes/config.yaml` by hand:

```yaml
mcp_servers:
  codex-cu:
    command: node
    args:
      - /absolute/path/to/codex-cu-bridge/bridge.mjs
```

Hermes also ships its own `computer_use` tool; this one is an alternative that drives the ChatGPT app's engine instead.

### Any other MCP client

Register a stdio server with this shape, using the absolute path to your clone:

```json
{ "mcpServers": { "codex-cu": { "command": "node", "args": ["/absolute/path/to/codex-cu-bridge/bridge.mjs"] } } }
```

Give the agent `docs/skill/SKILL.md` if your client supports skills, or paste `docs/CLAUDE-snippet.md` into its system instructions.

## App approvals

- **Default:** nothing is pre-approved. The first time the agent touches an app you get a native Allow / Always Allow / Deny dialog. Always Allow saves it to `~/.config/codex-cu-bridge/allow.json`.
- **Always asks, never remembered:** Mail, Messages, password apps, Keychain, Terminal, System Settings, Wallet, anything bank/Venmo/PayPal/Coinbase. These can't be allowlisted by any setting.
- **Skip the dialog for apps you trust:** set `CODEX_CU_ALLOW="Calculator,Notes,Reminders"` in the `env` of the `codex-cu` entry in your client's MCP config (Hermes: `hermes mcp add ... --env CODEX_CU_ALLOW=Calculator,Notes`), or click Always Allow once.
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

On 2026-10-13 with ChatGPT Computer Use `26.1007.41230`, Claude Code 2.1.296:
- `node test/e2e.mjs` drove Calculator through the bridge: typed `12*34=`, read back `408`
- A headless `claude -p` session, using only the `codex-cu` tool, computed 37×91 in Calculator and reported `3367`
- Hands-off: `claude -p "add 'buy milk' to my Reminders"` (no tool named, no permission flags) picked codex-cu itself, added exactly one reminder, 0 permission prompts
- Harness run after warm-up: 5s end to end (was 30-60s with a cold-start timeout)

## Caveats

Unofficial and not affiliated with OpenAI or Anthropic. Depends on undocumented ChatGPT app internals, so an app update can break it. Computer Use can read everything visible in an app you allow.

## Credit

Approach adapted from [shiptomorrow/claude-codex-computer-use](https://github.com/shiptomorrow/claude-codex-computer-use) and [bcharleson/codex-cu-mcp](https://github.com/bcharleson/codex-cu-mcp) (both MIT). See also [JoshFink/codex-cu](https://github.com/JoshFink/codex-cu).
