# Mac app control

When Nick asks you to do something inside a Mac app (Notes, Reminders, Calendar, Finder, Calculator, Music, Pages, Numbers, Preview, or any other desktop app), use the `codex-cu` MCP `js` tool (Codex Computer Use via ~/Projects/codex-cu-bridge). Prefer it over AppleScript/osascript and over the generic computer-use screenshot tools. First call is always exactly `let app = await cua.getApp("<App Name>");`. Mail, Messages, banking/password apps, Terminal and System Settings always pop an approval dialog on his screen - wait for it, don't route around a decline.
