# codex-cu-bridge

Turn the **Computer Use** engine that ships with the ChatGPT desktop app into an MCP server **any agent can use**: Claude Code, Hermes, OpenClaw, Claude Desktop, Cursor, VS Code, Gemini CLI, Goose, Zed, or anything else that can launch a stdio MCP server.

Your agent does the thinking; OpenAI's Computer Use helper does the clicking and typing in your Mac apps. No OpenAI API calls, no extra keys, no OpenAI code in this repo: it launches the copy already installed on your Mac.

## Quick start

**Using an AI agent?** Paste this into it:

> Install codex-cu-bridge for me by following https://raw.githubusercontent.com/nradawg/codex-cu-bridge/main/INSTALL.md

**Claude Code**, no clone needed, installs the server and the `/mac` skill together:

```
/plugin marketplace add nradawg/codex-cu-bridge
/plugin install codex-cu@codex-cu-bridge
```

**Everything else:**

```bash
git clone https://github.com/nradawg/codex-cu-bridge.git && cd codex-cu-bridge && ./install.sh
```

`install.sh` checks that Computer Use is installed, registers the bridge with every supported client CLI on your PATH (Claude Code, Hermes, OpenClaw) and prints the config for the rest. `./install.sh hermes` does one client, `./install.sh print` only prints, `./install.sh uninstall` removes what it registered.

For any MCP client, the server is simply:

```json
{ "mcpServers": { "codex-cu": { "command": "node", "args": ["/absolute/path/to/codex-cu-bridge/bridge.mjs"] } } }
```

No clone at all: `"command": "npx", "args": ["-y", "github:nradawg/codex-cu-bridge"]`. The first start takes a couple of seconds while npm fetches it.

Restart the client, then ask it to do something in a Mac app. The first call to each app pops an approval dialog (see [App approvals](#app-approvals)).

## Requirements

- macOS with the **ChatGPT desktop app** (the former Codex app) and its **Computer Use** plugin installed and used once: Settings → Computer use, or Plugins → Computer Use → Install plugin. The engine ships only with that app; the open-source Codex CLI does not include it ([openai/codex#20851](https://github.com/openai/codex/issues/20851)).
- Accessibility and Screen Recording granted to *Codex Computer Use* in System Settings → Privacy & Security
- Node 18+
- Any MCP client that can run a stdio server. Codex itself does not need the bridge: once the app is installed, `codex plugin list` shows `unified-computer-use@openai-bundled` and Codex talks to the engine directly.

## How it works

1. Installing the Computer Use plugin caches a bundled Codex plugin, `unified-computer-use`, under `~/.codex/plugins/cache/openai-bundled/`. Its `.mcp.json` describes an MCP server named `cua_repl` that runs out of `ChatGPT.app`. The names appear in the open-source [openai/codex](https://github.com/openai/codex) code, but the engine itself is closed and undocumented, and only Codex is meant to talk to it.
2. `bridge.mjs` is a plain stdio MCP server. It starts `cua_repl` and relays messages, so any MCP client can use it. It exposes two tools, `js` and `js_reset`, and prepends a quick-start cheat sheet to the `js` description so an agent can act on its first call.
3. It adds the three things Codex normally supplies and other clients don't:
   - **turn metadata** (`x-codex-turn-metadata`) on every call; browser control fails without it
   - **app consent**: apps in your allowlist are approved silently; anything else pops a native macOS *Allow / Always Allow / Deny* dialog, titled with your client's name. Nothing is approved by default.
   - **turn cleanup** (`turn_ended`) after 3 min idle and on exit, so Chrome tabs get released

## Client notes

<details><summary><b>Claude Code</b></summary>

- **Plugin (recommended):** `/plugin marketplace add nradawg/codex-cu-bridge` then `/plugin install codex-cu@codex-cu-bridge`, or from a shell `claude plugin install codex-cu --marketplace nradawg/codex-cu-bridge`. This installs the server *and* the `/mac` skill, and nothing is bound to a clone path. The tools are named `mcp__plugin_codex-cu_codex-cu__js` and `..._js_reset` if you want them in `permissions.allow`.
- **From a clone:** `./install.sh claude` runs `claude mcp add -s user codex-cu -- node "$PWD/bridge.mjs"`. Add the skill with `cp -r skills/mac ~/.claude/skills/mac`, and allow the tools with `"mcp__codex-cu__js"` and `"mcp__codex-cu__js_reset"` in `permissions.allow` of `~/.claude/settings.json`.
- Headless: `claude -p "add 'buy milk' to Reminders" --allowedTools mcp__codex-cu__js,mcp__codex-cu__js_reset`.
</details>

<details><summary><b>Hermes Agent</b></summary>

- `./install.sh hermes` runs `hermes mcp add codex-cu --command node --args "$PWD/bridge.mjs"` and answers Y to enable both tools (`--args` must be the last option; `--env KEY=VAL` goes before it). `hermes mcp test codex-cu` should connect and list `js` and `js_reset`; `/reload-mcp` loads it into an open session.
- Skill: `hermes skills install nradawg/codex-cu-bridge/skills/mac --yes`, or point it at the raw `SKILL.md` URL.
- Hermes also ships its own `computer_use` toolset (needs `cua-driver`); this bridge drives the ChatGPT app's engine instead.
</details>

<details><summary><b>OpenClaw</b></summary>

- `./install.sh openclaw` runs `openclaw mcp add codex-cu --command node --arg "$PWD/bridge.mjs"`, which probes the server before saving it under `mcp.servers.codex-cu` in `~/.openclaw/openclaw.json`. `openclaw mcp reload` picks it up; `openclaw mcp unset codex-cu` removes it.
- Skill: `openclaw skills install ./skills/mac --as mac` from the clone (the `git:` form needs `SKILL.md` at the repo root, so it doesn't apply here).
</details>

<details><summary><b>Cursor</b></summary>

`~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{ "mcpServers": { "codex-cu": { "type": "stdio", "command": "node", "args": ["/absolute/path/to/codex-cu-bridge/bridge.mjs"] } } }
```
</details>

<details><summary><b>Claude Desktop</b></summary>

Add the generic JSON above to `~/Library/Application Support/Claude/claude_desktop_config.json` and restart the app.
</details>

<details><summary><b>VS Code (Copilot agent mode)</b></summary>

```bash
code --add-mcp '{"name":"codex-cu","type":"stdio","command":"node","args":["/absolute/path/to/codex-cu-bridge/bridge.mjs"]}'
```
</details>

<details><summary><b>Gemini CLI</b></summary>

```bash
gemini mcp add -s user codex-cu node /absolute/path/to/codex-cu-bridge/bridge.mjs
```
</details>

<details><summary><b>Cline, Devin Desktop (formerly Windsurf), Zed, Continue</b></summary>

- Cline: generic JSON in `~/.cline/data/settings/cline_mcp_settings.json`
- Devin Desktop, legacy Cascade agent: generic JSON in `~/.config/devin/mcp_config.json`
- Zed: `"context_servers": { "codex-cu": { "command": "node", "args": ["/absolute/path/to/codex-cu-bridge/bridge.mjs"] } }` in `settings.json`
- Continue: a `mcpServers:` list item in `config.yaml` with `name: codex-cu`, `type: stdio`, `command: node`, `args: [...]`
</details>

<details><summary><b>Goose</b></summary>

Goose has no non-interactive add; use `goose configure` or edit `~/.config/goose/config.yaml`:

```yaml
extensions:
  codex-cu:
    enabled: true
    type: stdio
    name: codex-cu
    cmd: node
    args: ["/absolute/path/to/codex-cu-bridge/bridge.mjs"]
    envs: {}
    timeout: 300
```
</details>

### Teach the agent when to use it

`skills/mac/SKILL.md` is an [Agent Skills](https://agentskills.io) skill (`/mac`): first call `cua.getApp`, act, verify on screen, never route around a declined dialog. The Claude Code plugin includes it. Elsewhere:

- `npx skills add nradawg/codex-cu-bridge --skill mac -g -a claude-code` (also `codex`, `cursor`, `gemini-cli`, `github-copilot`, `openclaw`, `hermes-agent`, ...)
- Hermes and OpenClaw commands in the client notes above
- Clients without skills: paste `docs/CLAUDE-snippet.md` into their system instructions

## App approvals

- **Default:** nothing is pre-approved. The first time the agent touches an app you get a native Allow / Always Allow / Deny dialog, titled with the name your client sends in the MCP handshake. Always Allow saves the app to `~/.config/codex-cu-bridge/allow.json`.
- **Always asks, never remembered:** Mail, Messages, password apps, Keychain, Terminal, System Settings, Wallet, anything bank/Venmo/PayPal/Coinbase. These can't be allowlisted by any setting.
- **Skip the dialog for apps you trust:** click Always Allow once, or set `CODEX_CU_ALLOW="Calculator,Notes,Reminders"` in the server's `env`: `claude mcp add -s user -e CODEX_CU_ALLOW=Calculator,Notes --transport stdio codex-cu -- node ...` (Claude Code reads the name as another `-e` pair unless an option sits between them), `hermes mcp add ... --env CODEX_CU_ALLOW=... --args ...`, `openclaw mcp add ... --env CODEX_CU_ALLOW=...`, `envs:` for Goose, `env` in any JSON config. Plugin installs have no env hook; use the dialog or `allow.json`.
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

- **`doctor` says Computer Use is not installed:** open the ChatGPT app, install the Computer Use plugin and use it once.
- **Your Mac is locked:** Computer Use can't see or click anything on a locked screen; calls hang or fail (see [openai/codex#26415](https://github.com/openai/codex/issues/26415) for the history). Unlock it and retry.
- **Calls time out / e2e hangs:** quit the ChatGPT app fully, make sure `SkyComputerUseService` is gone (Activity Monitor), reopen ChatGPT, and check that *Codex Computer Use* has Accessibility and Screen & System Audio Recording in System Settings → Privacy & Security. Then rerun the e2e.
- **After a ChatGPT update:** nothing to reinstall; the bridge picks the newest installed Computer Use version each time it starts. Restart your client.

## Verified

- 2026-10-22, Computer Use `26.1013.40934`, Claude Code 2.1.308, Hermes Agent 0.22.4, OpenClaw 2026.6.11: the plugin installs into a fresh Claude Code config, connects the server and adds `/mac`; `hermes mcp add` and `openclaw mcp add` register the bridge and discover both tools (Hermes connects in about 2s); `npx skills add` finds the `mac` skill; the bridge started through `npx` from a git URL connects.
- 2026-10-13, Computer Use `26.1007.41230`, Claude Code 2.1.296:
  - `node test/e2e.mjs` drove Calculator through the bridge: typed `12*34=`, read back `408`
  - A headless `claude -p` session, using only the `codex-cu` tool, computed 37×91 in Calculator and reported `3367`
  - Hands-off: `claude -p "add 'buy milk' to my Reminders"` (no tool named, no permission flags) picked codex-cu itself, added exactly one reminder, 0 permission prompts
  - Harness run after warm-up: 5s end to end (was 30-60s with a cold-start timeout)

## Caveats

Unofficial, and not affiliated with or endorsed by OpenAI or Anthropic. It relies on undocumented ChatGPT app internals (the plugin cache layout, `x-codex-turn-metadata`, `turn_ended`, the `cua` JavaScript API), so any app update can break it. The bridge runs the engine already installed on your Mac, unmodified, and redistributes none of it; you need your own copy of the ChatGPT app. OpenAI's Terms of Use restrict modifying, distributing or circumventing protective measures of its services and OpenAI has not commented on third-party use of this engine, so review the terms yourself before relying on it. Computer Use can read everything visible in an app you allow.

## Credit

Approach adapted from [shiptomorrow/claude-codex-computer-use](https://github.com/shiptomorrow/claude-codex-computer-use) and [bcharleson/codex-cu-mcp](https://github.com/bcharleson/codex-cu-mcp) (both MIT). See also [syanbo/codex-cu](https://github.com/syanbo/codex-cu).
