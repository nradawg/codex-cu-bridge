# codex-cu-bridge

Let **Claude Code** control your Mac apps using the **Codex Computer Use** engine that ships inside the ChatGPT desktop app.

Claude does the thinking; Codex's helper does the clicking and typing. No OpenAI API calls, no extra keys, no OpenAI code in this repo - it launches the copy already on your Mac.

## How it works (simple version)

1. Turning on Computer Use in the ChatGPT app installs a hidden MCP server (`cua_repl`) under `~/.codex/plugins/cache/openai-bundled/unified-computer-use/`.
2. `bridge.mjs` starts that server and passes messages between it and Claude Code.
3. It adds the three things Codex normally sends and other clients don't:
   - **turn metadata** (`x-codex-turn-metadata`) on every call - browser control fails without it
   - **app consent** - apps in your allowlist are approved silently; anything else pops a native macOS *Allow / Always Allow / Deny* dialog. Nothing is approved by default.
   - **turn cleanup** (`turn_ended`) after 3 min idle and on exit, so Chrome tabs get released

## Requirements

- macOS, ChatGPT desktop app with **Codex → Computer Use turned on and used once**
- Accessibility + Screen Recording granted to *Codex Computer Use*
- Node 18+, Claude Code

## Install

```bash
git clone <this repo> && cd codex-cu-bridge && ./install.sh
```

Then restart Claude Code. Check health anytime with `node bridge.mjs doctor`.

## App approvals

- **Pre-approved:** Calculator, Notes, Finder, Preview, Calendar, Reminders, Music, Pages, Numbers, Keynote, TextEdit, Photos, Maps, Weather, Clock
- **Always asks, never remembered:** Mail, Messages, password apps, Keychain, Terminal, System Settings, Wallet, anything bank/Venmo/PayPal/Coinbase
- **Everything else:** native Allow / Always Allow / Deny dialog; Always Allow saves to `~/.config/codex-cu-bridge/allow.json`
- Extra apps via `CODEX_CU_ALLOW="Slack,Figma"`; `CODEX_CU_NATIVE_PROMPTS=0` turns off dialogs (unlisted apps are then declined)

## Speed

- Warms the Computer Use service on startup (~1s) so the first real call doesn't cold-start
- `js` calls default to a 90s timeout (`CODEX_CU_TIMEOUT_MS`); `CODEX_CU_WARMUP=0` disables warm-up
- A short API cheat sheet is prepended to the `js` tool description so Claude acts on its first call

## Zero-friction setup in Claude Code

- Add `"mcp__codex-cu__js"` and `"mcp__codex-cu__js_reset"` to `permissions.allow` in `~/.claude/settings.json`
- Add a line to `~/.claude/CLAUDE.md` telling Claude to use codex-cu for Mac-app tasks (see `docs/CLAUDE-snippet.md`)

## Verified

On 2026-10-13 with ChatGPT Computer Use `26.1007.41230`, Claude Code 2.1.296:
- `node test/e2e.mjs` drove Calculator through the bridge: typed `12*34=`, read back `408`
- A headless `claude -p` session, using only the `codex-cu` tool, computed 37×91 in Calculator and reported `3367`
- Hands-off: `claude -p "add 'buy milk' to my Reminders"` (no tool named, no permission flags) picked codex-cu itself, added exactly one reminder, 0 permission prompts
- Harness run after warm-up: 5s end to end (was 30-60s with a cold-start timeout)

## Caveats

Unofficial. Depends on undocumented ChatGPT app internals - an app update can break it. A single `js` call times out at 30s by default (pass `timeout_ms`). Computer Use can read everything visible in an app you allow.

## Credit

Approach adapted from [shiptomorrow/claude-codex-computer-use](https://github.com/shiptomorrow/claude-codex-computer-use) and [bcharleson/codex-cu-mcp](https://github.com/bcharleson/codex-cu-mcp) (both MIT). See also [JoshFink/codex-cu](https://github.com/JoshFink/codex-cu).
