# SelectionCopy Test Plan

Manual regression checklist covering Stage 5 scenarios.

| Scenario | Steps | Expected Result |
| --- | --- | --- |
| Browser Selection | Launch SelectionCopy, open any web browser, highlight text | Floating bubble appears near selection; clicking **Copy** writes to clipboard with feedback |
| Word / Notepad | Focus Microsoft Word or Notepad, select text | Bubble appears, copy succeeds without delay |
| Excel / PowerPoint | Focus Excel or PowerPoint, select cells or text | Bubble does **not** appear (blacklist enforcement) |
| Acrobat / WPS / Foxit | Highlight text in Acrobat Reader, WPS, or Foxit Reader | Bubble appears; copy waits for configured delay (default 280–320 ms) before succeeding |
| Remote Desktop | Focus Microsoft Remote Desktop window | Bubble suppressed while remote session is foreground |
| Dark Mode | Switch operating system to dark theme | Renderer updates styles automatically (background, typography, bubble colors) |
| Startup | Reboot or log out/in with `autoLaunch: true` | SelectionCopy starts automatically and tray icon is present |
| Tray Menu | Interact with tray icon | Open: reveals renderer window; Settings: opens config folder; Toggle Auto Launch: flips config flag; Quit: exits app |
| Config Reload | Edit `%AppData%/SelectionCopy/config.json` (e.g., add blacklist entry) | Renderer applies changes without restart; tray menu reflects auto-launch flag |
| Logging | Force clipboard error (disable clipboard permissions) | Error entry appended to `%AppData%/SelectionCopy/logs/application.log` |

> Tip: Use `config/defaultConfig.json` as a known-good baseline if configuration becomes inconsistent.
