# SelectionCopy (Fast Copy)

Lightweight Electron utility that surfaces a floating copy button when you highlight text. Designed for Windows environments where quick clipboard access is essential, while gracefully backing off in high-conflict applications such as Excel or Photoshop.

> 轻量级 Electron “选中即复制” 工具：在 Windows 上选中文本时弹出悬浮复制按钮，一键写入剪贴板；在高风险程序中自动禁用。

## Features

- Floating bubble appears near any text selection with animated copy feedback.
- Configurable blacklist to disable the UI in specific foreground processes (`excel.exe`, `photoshop.exe`, ...).
- Per-application copy delays (e.g., Acrobat / WPS / Foxit Reader) to avoid clipboard contention.
- Auto-detects system light/dark theme and supports fully custom bubble colors.
- Tray icon with quick actions (open config folder, toggle auto-launch, quit).
- Auto-start on login (configurable) and persistent JSON configuration under `%AppData%`.
- Structured JSON logging for clipboard or permission issues.

## Prerequisites

- Node.js 18+
- npm 9+
- Windows 10+ (primary target). macOS/Linux can be used for development, but packaging defaults target Windows.

## Quick Start

```bash
npm install
npm start
```

`npm start` launches Electron in development mode with the demo window (`src/index.html`). Select any text to test the floating button experience.

## Configuration

- Location: `%AppData%/SelectionCopy/config.json` (auto-created on first launch).
- Reference template: `config/defaultConfig.json`.

Key options:

```json
{
  "blacklist": ["excel.exe", "photoshop.exe"],
  "delayedCopy": {
    "defaultDelayMs": 0,
    "apps": {
      "acrobat.exe": 320,
      "wps.exe": 280
    }
  },
  "animations": { "enable": true },
  "theme": "system",
  "bubbleStyle": {
    "accentColor": "#4c82ff",
    "textColor": "#ffffff",
    "backgroundColor": "rgba(31, 31, 45, 0.9)"
  },
  "autoLaunch": true
}
```

Editing `config.json` will automatically refresh the renderer. Use the tray menu (Settings) to open the folder quickly.

## Logs

- Location: `%AppData%/SelectionCopy/logs/application.log`
- Format: newline-delimited JSON with timestamp, level, message, and payload.

## Packaging

```bash
npm run package
```

- Uses `electron-builder` with `NSIS` target on Windows.
- Generated artifacts land in `dist/`.
- Application/product name: **SelectionCopy**
- App ID: `com.selectioncopy.fastcopy`
- Bundles the tray icon (`assets/tray.png`) and app icon (`assets/app-icon.ico`).

## Tray Menu

- **Open** – reveal the renderer window.
- **Settings** – open the configuration directory.
- **Enable/Disable Auto Launch** – toggles login startup (`autoLaunch` flag in config).
- **Quit** – close the background process.

## Development Checklist

- [x] Selection → bubble → copy flow (Stage 1)
- [x] Foreground process detection with blacklist & delay controls (Stage 2)
- [x] Theming, positioning safeguards, custom animations, config file (Stage 3)
- [x] Tray integration, auto-launch, packaging, logging (Stage 4)
- [x] Manual regression checklist (`docs/test-plan.md`) (Stage 5)

## Roadmap (v2+ Ideas)

- Keyboard shortcut to force copy (`Ctrl+Shift+C`).
- Multi-action bubble (copy / search / translate).
- Rich analytics and error reporting channel.

---

Made with ❤️ for productivity enthusiasts who live in copy/paste. Contributions and feedback are welcome once the project is live on GitHub.
