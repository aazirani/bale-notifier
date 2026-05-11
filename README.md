# Bale Notifier

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-green.svg)](package.json)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](Dockerfile)

Monitor [Bale messenger](https://web.bale.ai) for new messages and incoming calls, then forward notifications to **Telegram**, **Discord**, or **Slack**.

Runs headless in Docker with Puppeteer — no desktop needed. Single container supports multiple users.

## Features

- **Message monitoring** — Detects new unread messages in Bale chats via WebSocket protobuf interception
- **Call alerts** — Notifies on incoming voice/video calls via DOM monitoring
- **Multi-tenant** — Multiple users in a single container with shared browser
- **Multi-channel** — Forwards to Telegram, Discord, or Slack
- **Docker-ready** — Single `docker compose up` to start
- **noVNC access** — Browser-based remote access for Bale login on headless servers
- **Auto-reconnect** — Recovers from browser crashes with exponential backoff
- **Channel validation** — Validates bot tokens and webhook URLs during setup
- **Re-login protection** — Max 3 attempts, then 30-min cooldown with notification

## Quick Start

### With Docker (recommended)

```bash
git clone https://github.com/aazirani/bale-notifier.git
cd bale-notifier
docker compose up --build -d
```

Add your first user:

```bash
docker compose exec bale-notifier bale add-user
```

The setup wizard will:
1. **Configure server IP** — Enter your server's external IP (for noVNC re-login links)
2. **Authenticate with Bale** — A noVNC URL is shown. Open it in your browser and log into Bale.
3. **Choose notification channel** — Select Telegram, Discord, or Slack and provide credentials. They're validated immediately.
4. **Set preferences** — Choose which events to be notified about.

Config is saved to `./data/users/<user-id>/config.json`. Session data persists in `./data/users/<user-id>/session/`.

### Adding More Users

```bash
docker compose exec bale-notifier bale add-user
```

Each user gets a unique noVNC port (6081, 6082, etc.) automatically allocated from the port range.

### Other Commands

```bash
docker compose exec bale-notifier bale list-users    # List all configured users
docker compose exec bale-notifier bale status         # Show running session status
docker compose exec bane-notifier bale remove-user    # Remove a user and their data
```

### Without Docker

Requires Node.js 20+ and Chromium installed:

```bash
git clone https://github.com/aazirani/bale-notifier.git
cd bale-notifier
npm install
npm run build
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser node dist/main.js add-user
```

## Configuration

### Master Config (`./data/master.json`)

Global settings shared across all users:

```json
{
  "serverIp": "203.0.113.10",
  "novncPortRange": [6081, 6090],
  "loginTimeoutMinutes": 15,
  "userPorts": {
    "alice": 6081,
    "bob": 6082
  }
}
```

Created automatically on first `add-user`. The server IP is asked once and reused for subsequent users.

### User Config (`./data/users/{userId}/config.json`)

Per-user settings created by the setup wizard:

```json
{
  "bale": {
    "sessionDir": "/data/users/alice/session"
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
| `DATA_DIR` | `/data` | Base data directory |
| `PUPPETEER_EXECUTABLE_PATH` | — | Path to Chromium binary |
| `DISPLAY` | — | X11 display for headed mode |

### noVNC (Headless Servers)

When running on a server without a desktop, the wizard starts noVNC on the user's allocated port. The URL (with your server's external IP) is displayed during setup.

```
http://<server-ip>:<user-port>/vnc.html?autoconnect=true
```

Ports are stable — removing a user doesn't shift other users' ports.

## Architecture

```
Shared Puppeteer Browser
  ├─ User Context (alice) → WS Interceptor → Decoder → Event Parser → Telegram
  ├─ User Context (bob)   → WS Interceptor → Decoder → Event Parser → Discord
  └─ User Context (carol) → WS Interceptor → Decoder → Event Parser → Slack
```

- **Shared Browser** — One Chromium instance with isolated browser contexts per user (~700MB total for 10 users)
- **WebSocket Interception** — Replaces WebSocket constructor to intercept Bale's protobuf frames
- **Session Persistence** — Cookies + localStorage saved/restored per user
- **FSWatcher** — Auto-detects new users and starts monitoring with 2-second debounce
- **Channels** — Pluggable notification targets with retry logic and immediate validation

## Development

```bash
npm install        # Install dependencies
npm run build      # Compile TypeScript
npm test           # Run test suite (76 tests)
npm run test:watch # Run tests in watch mode
```

## Troubleshooting

**"Bale session expired"** — The notifier starts a re-login flow and sends a noVNC link. After 3 failed attempts, monitoring pauses for 30 minutes and you'll need to re-login manually.

**No notifications arriving** — Set `LOG_LEVEL=debug` to see WebSocket frame decoding details. Check that cookies + localStorage are being saved in `./data/users/<id>/session/`.

**noVNC not loading** — Ensure ports 6081-6090 are not blocked by a firewall. Check the user's allocated port in `./data/master.json`.

**Empty Telegram getUpdates** — Open the getUpdates URL in a new browser window (or incognito). If still empty, send a new message to the bot and refresh.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

[MIT](LICENSE)
