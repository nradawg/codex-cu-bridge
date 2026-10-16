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
git clone https://github.com/nradawg/codex-cu-bridge.git && cd codex-cu-bridge && ./install.sh
```

Then restart Claude Code. Check health anytime with `node bridge.mjs doctor`.

## App approvals

- **Default:** nothing is pre-approved. The first time Claude touches an app you get a native Allow / Always Allow / Deny dialog. Always Allow saves it to `~/.config/codex-cu-bridge/allow.json`.
- **Always asks, never remembered:** Mail, Messages, password apps, Keychain, Terminal, System Settings, Wallet, anything bank/Venmo/PayPal/Coinbase. These can't be allowlisted by any setting.
- **Skip the dialog for apps you trust:** `CODEX_CU_ALLOW="Calculator,Notes,Reminders"` (set it in the `env` of the `codex-cu` entry in your Claude Code MCP config), or click Always Allow once.
- `CODEX_CU_NATIVE_PROMPTS=0` turns off dialogs; anything not allowlisted is then declined.

## Speed

- Warms the Computer Use service in the background on startup so the first real call doesn't cold-start. It never blocks your calls; `CODEX_CU_WARMUP=0` turns it off
- `js` calls default to a 90s timeout (`CODEX_CU_TIMEOUT_MS`, or pass `timeout_ms` per call)
- A short API cheat sheet is prepended to the `js` tool description so Claude acts on its first call

## Zero-friction setup in Claude Code

- Add `"mcp__codex-cu__js"` and `"mcp__codex-cu__js_reset"` to `permissions.allow` in `~/.claude/settings.json`
- Add a line to `~/.claude/CLAUDE.md` telling Claude to use codex-cu for Mac-app tasks (see `docs/CLAUDE-snippet.md`)

## Tests

- `npm test` runs protocol tests against a mock Computer Use server (works on any OS, no ChatGPT needed): tool filtering, hidden-tool rejection, request id isolation, non-blocking warm-up, consent defaults, cancellation and server-request remapping.
- `node test/e2e.mjs 'let app = await cua.getApp("Calculator");'` runs against the real thing on your Mac and exits 1 on any error or hang.

## Troubleshooting

- **`doctor` says Computer Use is not installed:** open the ChatGPT app, go to Codex, turn on Computer Use and use it once.
- **Calls time out / e2e hangs:** quit the ChatGPT app fully, make sure `SkyComputerUseService` is gone (Activity Monitor), reopen ChatGPT, and check that *Codex Computer Use* has Accessibility and Screen & System Audio Recording in System Settings → Privacy & Security. Then rerun the e2e.
- **After a ChatGPT update:** rerun `./install.sh`; the bridge always picks the newest installed Computer Use version.

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
