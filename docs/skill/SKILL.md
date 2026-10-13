---
name: mac
description: Do a task inside a Mac desktop app (Notes, Reminders, Calendar, Finder, Calculator, Music, Pages, Numbers, Preview, etc.) using Codex Computer Use through the codex-cu MCP bridge. Use when Nick says /mac, "on my Mac", "in Notes/Reminders/Calendar", "open X and do Y", or any request to operate a native app.
---

# /mac - drive Mac apps via codex-cu

Use the `codex-cu` MCP `js` tool (bridge at ~/Projects/codex-cu-bridge). Not osascript, not screenshot computer-use.

1. First call, exactly one statement: `let app = await cua.getApp("<App Name>");` - read the returned UI state and docs.
2. Act: `app.typeText()`, `app.pressKey("cmd+n" | "Return" | "Escape")`, `app.click(<element #>)`, `app.setValue(<#>, "text")`.
3. Verify: `nodeRepl.write(await app.getAXState())` and confirm the change is actually on screen before reporting done.
4. Report what changed in one line.

Rules:
- Sensitive apps (Mail, Messages, banking, passwords, Terminal, System Settings) pop an approval dialog every time. If Nick declines, stop - never work around it.
- Never send a message/email or submit/buy anything without Nick confirming in chat first.
- If a call times out, call `js_reset` and retry once. If `codex-cu` is missing or errors, run `node ~/Projects/codex-cu-bridge/bridge.mjs doctor` and report.
