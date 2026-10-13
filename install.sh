#!/usr/bin/env bash
# Registers codex-cu-bridge with Claude Code (user scope). Safe to re-run.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
command -v node >/dev/null || { echo "Node 18+ is required"; exit 1; }
node "$DIR/bridge.mjs" doctor
claude mcp remove codex-cu -s user >/dev/null 2>&1 || true
claude mcp add -s user codex-cu -- node "$DIR/bridge.mjs"
echo "Installed. Restart Claude Code, then ask it to use the codex-cu tool."
