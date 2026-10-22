# Installing codex-cu-bridge

Written for AI agents doing the install on a user's behalf; it works for humans too. Follow the steps in order and do not skip the checks. Change only your own MCP configuration (and the skill directory, if asked); tell the user about every file you touch.

## 1. Check the machine

- macOS only.
- The ChatGPT desktop app with its Computer Use plugin must be installed and have been used once. Check: `ls ~/.codex/plugins/cache/openai-bundled/unified-computer-use/` lists at least one version directory. If it doesn't, stop and tell the user to open the ChatGPT app, install Computer Use (Settings → Computer use, or Plugins → Computer Use → Install plugin), run it once, and grant Accessibility and Screen Recording to *Codex Computer Use* when macOS asks.
- `node --version` is 18 or newer.

## 2. Install the server

Pick exactly one path.

**Claude Code:** `claude plugin marketplace add nradawg/codex-cu-bridge` then `claude plugin install codex-cu@codex-cu-bridge` (inside Claude Code: `/plugin marketplace add nradawg/codex-cu-bridge`, `/plugin install codex-cu@codex-cu-bridge`). This installs the server and the `/mac` skill; skip step 4.

**A client whose CLI the installer knows (Hermes, OpenClaw, Claude Code without the plugin):**

```bash
git clone https://github.com/nradawg/codex-cu-bridge.git ~/.local/share/codex-cu-bridge
cd ~/.local/share/codex-cu-bridge && ./install.sh
```

Any stable directory is fine; the registration stores its absolute path. The script registers with every supported CLI it finds; `./install.sh hermes` limits it to one.

**Any other MCP client:** register a stdio server named `codex-cu` using your own mechanism, with command `node` and the single argument `/absolute/path/to/codex-cu-bridge/bridge.mjs` (after cloning as above), or command `npx` with arguments `-y github:nradawg/codex-cu-bridge` (no clone). Known recipes:

| Client | Where |
|---|---|
| Claude Code (manual) | `claude mcp add -s user codex-cu -- node /abs/bridge.mjs` |
| Hermes Agent | `hermes mcp add codex-cu --command node --args /abs/bridge.mjs`, answer Y; or `mcp_servers:` in `~/.hermes/config.yaml` |
| OpenClaw | `openclaw mcp add codex-cu --command node --arg /abs/bridge.mjs`; stored under `mcp.servers` in `~/.openclaw/openclaw.json` |
| Cursor | `~/.cursor/mcp.json`, `mcpServers`, add `"type": "stdio"` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json`, `mcpServers` |
| VS Code | `code --add-mcp '{"name":"codex-cu","type":"stdio","command":"node","args":["/abs/bridge.mjs"]}'` |
| Gemini CLI | `gemini mcp add -s user codex-cu node /abs/bridge.mjs` |
| Cline | `~/.cline/data/settings/cline_mcp_settings.json`, `mcpServers` |
| Goose | `extensions:` in `~/.config/goose/config.yaml` (`type: stdio`, `cmd: node`, `args: [...]`, `envs: {}`) |
| Zed | `context_servers` in `settings.json` |
| Codex CLI | not needed; with the ChatGPT app installed Codex uses the engine directly |

## 3. Verify

1. `node /absolute/path/to/bridge.mjs doctor` prints a line starting with `ok  Codex Computer Use`. A `BAD` line about the screen being locked only means the Mac is locked right now; everything else must be fixed before continuing. (For the Claude Code plugin the file lives under `~/.claude/plugins/cache/codex-cu-bridge/codex-cu/<version>/bridge.mjs`.)
2. Restart or reload the client and confirm it lists two tools from `codex-cu`: `js` and `js_reset`. Hermes: `hermes mcp test codex-cu`. OpenClaw: `openclaw mcp probe`. Claude Code: `claude mcp list`.
3. Optional live check while the Mac is unlocked: `node /absolute/path/to/bridge.mjs doctor --live`.

## 4. Give the agent the skill

`skills/mac/SKILL.md` tells an agent when and how to use the tool (always start with `let app = await cua.getApp("<App Name>");`, verify on screen, never route around a declined approval).

- Claude Code: included in the plugin; from a clone, `cp -r skills/mac ~/.claude/skills/mac`
- Hermes: `hermes skills install nradawg/codex-cu-bridge/skills/mac --yes`
- OpenClaw: `openclaw skills install /absolute/path/to/codex-cu-bridge/skills/mac --as mac`
- Anything the `skills` CLI supports: `npx skills add nradawg/codex-cu-bridge --skill mac -g -a <agent>`
- No skill support: add the text of `docs/CLAUDE-snippet.md` to the agent's instructions

## 5. Tell the user

- The first time the agent touches an app, a native macOS dialog asks to Allow, Always Allow or Deny it. Always Allow is remembered in `~/.config/codex-cu-bridge/allow.json`.
- Mail, Messages, password managers, Keychain, Terminal, System Settings, Wallet and banking or payment apps ask every time and cannot be pre-approved.
- The Mac must be unlocked while the agent works.
- List the exact files and commands you changed, and that `./install.sh uninstall` (or removing the `codex-cu` server from the client config) undoes it.
