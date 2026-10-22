#!/usr/bin/env bash
# Registers codex-cu-bridge with the MCP clients on this Mac. Safe to re-run.
#   ./install.sh            register with every supported client CLI found on PATH
#   ./install.sh claude     just one of: claude | hermes | openclaw
#   ./install.sh print      only print the config for manual setup
#   ./install.sh uninstall  remove the registrations this script makes
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE="$DIR/bridge.mjs"
SKILL_URL="https://raw.githubusercontent.com/nradawg/codex-cu-bridge/main/skills/mac/SKILL.md"

print_manual() {
  cat <<MANUAL
Register the bridge in your MCP client as a stdio server:
  command: node
  args:    $BRIDGE

JSON form (Claude Desktop, Cursor, Cline, Claude Code's add-json, ...):
  { "mcpServers": { "codex-cu": { "command": "node", "args": ["$BRIDGE"] } } }

Skill for the agent: $DIR/skills/mac/SKILL.md
(or paste $DIR/docs/CLAUDE-snippet.md into the agent's instructions)
MANUAL
}

register_claude() {
  if claude plugin list 2>/dev/null | grep -q 'codex-cu@codex-cu-bridge'; then
    echo "Claude Code: the codex-cu plugin is already installed (it bundles the server and the /mac skill); nothing to register."
    return 0
  fi
  claude mcp remove codex-cu -s user >/dev/null 2>&1 || true
  claude mcp add -s user codex-cu -- node "$BRIDGE"
  echo "Claude Code: registered. Restart Claude Code."
  echo "  Optional skill: cp -r \"$DIR/skills/mac\" ~/.claude/skills/mac"
  echo "  (Or skip the clone next time: /plugin marketplace add nradawg/codex-cu-bridge, then /plugin install codex-cu@codex-cu-bridge)"
}

register_hermes() {
  printf 'Y\n' | hermes mcp remove codex-cu >/dev/null 2>&1 || true
  printf 'Y\nY\n' | hermes mcp add codex-cu --command node --args "$BRIDGE"
  echo "Hermes: registered. Start a new session or run /reload-mcp."
  echo "  Optional skill: hermes skills install $SKILL_URL --yes"
}

register_openclaw() {
  openclaw mcp add codex-cu --command node --arg "$BRIDGE"
  echo "OpenClaw: registered. Run 'openclaw mcp reload' or start a new session."
  echo "  Optional skill: openclaw skills install \"$DIR/skills/mac\" --as mac"
}

unregister_all() {
  local found=0
  if command -v claude >/dev/null; then
    found=1
    if claude plugin list 2>/dev/null | grep -q 'codex-cu@codex-cu-bridge'; then
      claude plugin uninstall codex-cu@codex-cu-bridge && echo "Claude Code: plugin uninstalled."
    fi
    if claude mcp remove codex-cu -s user >/dev/null 2>&1; then echo "Claude Code: user-scope server removed."; fi
  fi
  if command -v hermes >/dev/null; then
    found=1
    if printf 'Y\n' | hermes mcp remove codex-cu >/dev/null 2>&1; then echo "Hermes: server removed."; fi
  fi
  if command -v openclaw >/dev/null; then
    found=1
    if openclaw mcp unset codex-cu >/dev/null 2>&1; then echo "OpenClaw: server removed."; fi
  fi
  [ "$found" = 1 ] || echo "No supported client CLI (claude, hermes, openclaw) is on PATH; nothing to remove."
  echo "Skills and ~/.config/codex-cu-bridge/allow.json are left in place; delete them by hand if you want."
}

target="${1:-auto}"
case "$target" in
  uninstall) unregister_all; exit 0 ;;
  auto|print|claude|hermes|openclaw) ;;
  *) echo "usage: ./install.sh [claude|hermes|openclaw|print|uninstall]"; exit 2 ;;
esac

command -v node >/dev/null || { echo "Node 18+ is required"; exit 1; }
# doctor exits 1 when Computer Use is missing and also when the screen is locked.
# Only the first one should stop an install.
set +e
report="$(node "$BRIDGE" doctor 2>&1)"
set -e
echo "$report"
if ! grep -q '^ok  Codex Computer Use' <<<"$report"; then
  echo "Fix the problem above, then re-run ./install.sh"
  exit 1
fi
echo

case "$target" in
  print)
    print_manual ;;
  claude|hermes|openclaw)
    if ! command -v "$target" >/dev/null; then
      echo "'$target' is not on PATH, so nothing was registered."
      print_manual
      exit 1
    fi
    "register_$target" ;;
  auto)
    found=0
    for c in claude hermes openclaw; do
      if command -v "$c" >/dev/null; then
        "register_$c"
        echo
        found=1
      fi
    done
    if [ "$found" = 0 ]; then
      echo "No supported client CLI (claude, hermes, openclaw) is on PATH, so nothing was registered."
      print_manual
      exit 1
    fi ;;
esac
