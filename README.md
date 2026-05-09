# Bale Notifier

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-green.svg)](package.json)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](Dockerfile)

Monitor [Bale messenger](https://web.bale.ai) for new messages and incoming calls, then forward notifications to **Telegram**, **Discord**, or **Slack**.

Runs headless in Docker with Puppeteer — no desktop needed.

## Features

- **Message monitoring** — Detects new unread messages in Bale chats
- **Call alerts** — Notifies on incoming voice/video calls
- **Multi-channel** — Forwards to Telegram, Discord, or Slack
- **Docker-ready** — Single `docker compose up` to start
- **noVNC access** — Browser-based remote access for Bale login on headless servers
- **Auto-reconnect** — Recovers from browser crashes with exponential backoff
- **Retry logic** — Retries failed notification deliveries with exponential backoff

## Quick Start

### With Docker (recommended)

```bash
git clone https://github.com/aazirani/bale-notifier.git
cd bale-notifier
docker compose up --build
```

First run launches a setup wizard:

1. **Authenticate with Bale** — A browser opens (or noVNC URL is shown on headless servers). Log into Bale with your phone number and SMS code.
2. **Choose notification channel** — Select Telegram, Discord, or Slack and provide credentials.
3. **Set preferences** — Choose which events to be notified about.

Config is saved to `./data/config.json`. Session data persists in `./data/bale-session/`.

### Without Docker

Requires Node.js 20+ and Chromium installed:

```bash
git clone https://github.com/aazirani/bale-notifier.git
cd bale-notifier
npm install
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser npm start
```

## Configuration

The setup wizard creates `./data/config.json`:

```json
{
  "bale": {
    "sessionDir": "/data/bale-session"
  },
  "channel": {
    "type": "telegram",
    "telegram": {
      "botToken": "123456:ABC-DEF",
      "chatId": 987654321
    }
  },
  "notifications": {
    "messages": true,
    "calls": true,
    "groups": true
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Logging verbosity: `debug`, `info`, `warn`, `error` |
| `CONFIG_PATH` | `/data/config.json` | Path to config file |
| `PUPPETEER_EXECUTABLE_PATH` | — | Path to Chromium binary |
| `DISPLAY` | — | X11 display for headed mode |

### noVNC (Headless Servers)

When running on a server without a desktop, the wizard starts noVNC on port **6080**. Open `http://your-server:6080/vnc.html?autoconnect=true` in your browser to complete Bale login.

## Architecture

```
Bale Web (Puppeteer) → DOM MutationObserver → Event Parser → Notification Channel
                                                                          ├─ Telegram
                                                                          ├─ Discord
                                                                          └─ Slack
```

- **Browser Engine** — Headless Chromium loads `web.bale.ai` and monitors the DOM for changes
- **DOM Monitoring** — MutationObserver detects call modals and unread badge changes
- **Event Parser** — Converts DOM mutations into typed events
- **Channels** — Pluggable notification targets with retry logic

## Development

```bash
npm install        # Install dependencies
npm run build      # Compile TypeScript
npm test           # Run test suite
npm run test:watch # Run tests in watch mode
npm run dev        # Watch mode for development
```

## Troubleshooting

**"Bale session expired"** — Delete `./data/bale-session` and `./data/config.json`, then restart to re-authenticate.

**No notifications arriving** — Set `LOG_LEVEL=debug` to see detailed monitoring output. Check that your bot token/webhook URL is valid.

**noVNC not loading** — Ensure port 6080 is not blocked by a firewall. The container must be running with `tty: true`.

**Empty Telegram getUpdates** — Open the getUpdates URL in a new browser window (or incognito). If still empty, send a new message to the bot and refresh.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

[MIT](LICENSE)
