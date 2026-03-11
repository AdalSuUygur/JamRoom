# JamRoom

JamRoom is a Chrome and Firefox extension that synchronizes YouTube video playback between users connected to the same room — in real time.

## Features

- 🎬 Real-time play / pause / seek synchronization
- 🔗 Video change synchronization within YouTube
- 📋 Shared queue — add YouTube videos, auto-advance when one ends
- 👥 Live member list with nickname support
- 🔄 Auto-reconnect with 30-second grace period
- 🔒 Room-based session model
- 🌍 Chrome and Firefox compatible (MV3)

## Technology

- Chrome / Firefox Extension (Manifest V3)
- Node.js + Socket.io backend
- Hosted on Render

## Installation (Development)

### Chrome

1. Download the extension folder.
2. Open `chrome://extensions/`
3. Enable **Developer Mode**.
4. Click **Load unpacked** and select the extension folder.

### Firefox

1. Download the extension folder.
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** and select `manifest.json`.

## Known Limitations

- Firefox < 128: users appear as "Guest N" (MAIN world script not supported in older versions)
- Muted leader in background tab may cause followers to pause — tracked in [#40](https://github.com/AdalSuUygur/JamRoom/issues/40)

## License

MIT License
