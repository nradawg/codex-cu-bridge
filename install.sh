#!/usr/bin/env bash
# Registers codex-cu-bridge with Claude Code (user scope). Safe to re-run.
# Using Hermes or another MCP client? The bridge is a plain stdio MCP server; see README.md.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
command -v node >/dev/null || { echo "Node 18+ is required"; exit 1; }

# doctor exits 1 for a missing Computer Use install and also for a locked screen.
# Only the first one should stop an install.
set +e
report="$(node "$DIR/bridge.mjs" doctor 2>&1)"
set -e
echo "$report"
if ! grep -q '^ok  Codex Computer Use' <<<"$report"; then
  echo "Fix the problem above, then re-run ./install.sh"
  exit 1
fi

if ! command -v claude >/dev/null; then
  echo
  echo "The 'claude' CLI is not on PATH, so nothing was registered automatically."
  echo "Register the bridge in your MCP client as a stdio server:"
  echo "  command: node"
  echo "  args:    $DIR/bridge.mjs"
  echo "Hermes:    hermes mcp add codex-cu --command node --args \"$DIR/bridge.mjs\""
  echo "Skill:     $DIR/docs/skill/SKILL.md"
  exit 1
fi

claude mcp remove codex-cu -s user >/dev/null 2>&1 || true
claude mcp add -s user codex-cu -- node "$DIR/bridge.mjs"
echo "Installed. Restart Claude Code, then ask it to use the codex-cu tool."
echo "Optional: cp -r \"$DIR/docs/skill\" ~/.claude/skills/mac   (adds the /mac skill)"
