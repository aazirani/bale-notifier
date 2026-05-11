# Bale Notifier

Docker-packaged multi-tenant notification forwarder that monitors web.bale.ai for new messages and calls, then pushes them to Telegram/Discord/Slack.

## Architecture

- **Orchestrator** (`src/orchestrator.ts`) — Manages shared Puppeteer browser, per-user browser contexts, and filesystem watcher for auto-discovery of new users
- **CLI** (`src/cli.ts`) — User management commands: `add-user`, `remove-user`, `list-users`, `status`. Initializes master.json with server IP before running the wizard.
- **Setup Wizard** (`src/setup/wizard.ts`) — Terminal CLI using Inquirer.js. Opens browser for Bale auth, configures output channel, validates channel credentials, saves to per-user config.
- **Notification Engine** (`src/engine/`) — Headless Chromium with MutationObserver + WebSocket protobuf interception. Routes events to output channels.
- **Session Persistence** (`src/storage.ts`, `src/cookies.ts`) — Saves and restores cookies + localStorage per user, so Bale WebSocket auth tokens survive context recreation.
- **Output Channels** (`src/channels/`) — Pluggable targets implementing `NotificationChannel` interface. Supported: Telegram, Discord, Slack.
- **noVNC** (`src/setup/novnc.ts`) — Xvfb + x11vnc + websockify for remote browser access on headless servers. Shared Xvfb, per-user sessions.

## Bale Protocol Notes

- Bale uses **Protocol Buffers over WebSocket** (`wss://next-ws.bale.ai/ws/`), NOT JSON
- WebSocket `binaryType` is `"blob"` — ws-hook.ts must handle Blob→ArrayBuffer conversion
- ServerEnvelope (field 2 = update, field 1 = response, field 4 = pong)
- Updates use two-layer wrapper: UpdatePayload (field 1 = content bytes, field 3 = seq, field 4 = timestamp) → NewMessageUpdate (field 55 = newMessage bytes) → NewMessage
- NewMessage: field 1 = Peer(from), field 2 = senderUid, field 3 = date(ms), field 4 = rid, field 5 = MessageContent(bytes), field 14 = Peer(to)
- MessageContent uses field 15 for TextMessage, field 4 for document, field 3 for deleted
- We also use **DOM monitoring** for call detection: MutationObserver watches for call modals
- Key DOM selectors:
  - Incoming call: `.ReactModal__Overlay` with "Answer"/"Decline" text, caller name in `.HOE2x2`
  - Unread badge: `.eVv8xC` span with numeric count
- Login flow: phone number entry → SMS code to mobile app → enter code → chat list loads

## Configuration

- **Master config** (`/data/master.json`) — Server IP, noVNC port range, persistent port allocation (`userPorts` map), login timeout. Created by CLI or orchestrator on first run.
- **User config** (`/data/users/{userId}/config.json`) — Per-user Bale session dir, channel config, notification preferences. Created by the setup wizard.
- **User session** (`/data/users/{userId}/session/`) — Puppeteer profile with cookies + localStorage persistence.

## Commands

- `npm run build` — Compile TypeScript
- `npm start` — Start the multi-tenant orchestrator (no args)
- `npm test` — Run vitest suite
- `npm run test:watch` — Run tests in watch mode

Inside the container via `bin/bale`:
- `bale add-user` — Interactive setup: configures server IP (first time), then Bale auth + channel + preferences
- `bale remove-user` — Removes a user and their data
- `bale list-users` — Lists all configured users
- `bale status` — Shows running session status

## Testing

Tests use vitest. Channel tests mock their APIs (Telegram bot, global fetch for Discord/Slack). Config tests use temp directories. Event parser tests cover DOM notification parsing. Storage tests cover localStorage persistence.

## Docker

```bash
docker compose up --build
# Ports 6081-6090 for per-user noVNC (auto-allocated)
# Volume: ./data:/data (master config + user configs + sessions)
```

### Adding Users

```bash
docker compose exec bale-notifier bale add-user
# First run asks for server IP, then walks through Bale auth + channel setup
# Subsequent users reuse the server IP
```

### Re-login

When a Bale session expires, the monitor:
1. Starts noVNC on the user's allocated port
2. Sends a re-login notification with the noVNC URL
3. Waits up to 10 minutes for re-login
4. After 3 failed attempts, enters 30-min cooldown

### Access noVNC

```
http://<server-ip>:<user-port>/vnc.html?autoconnect=true
```

Port allocation is persistent (stored in master.json). First user gets 6081, second gets 6082, etc.

## Key Implementation Details

- **Browser contexts** — Single shared Puppeteer browser with per-user `BrowserContext` for isolation. Cookies + localStorage are saved/restored on context close.
- **Port stability** — Ports assigned from master.json `userPorts` map. Removing a user doesn't shift other users' ports.
- **FSWatcher debounce** — 2-second debounce on `/data/users/` changes, with config.json validation before auto-starting users.
- **Re-login safety** — Checks Xvfb availability before starting noVNC. Falls back to shared browser context if Xvfb is unavailable.
- **Decoder logging** — Undecoded WebSocket frames logged at debug level with frame size and first 8 bytes as hex.

## Project Structure

```
src/
├── types.ts              # BaleEvent, AppConfig, MasterConfig, NotificationChannel interface
├── config.ts             # Load/save/validate config, discoverUsers, ensureMasterConfig
├── storage.ts            # localStorage persistence (save/load per session dir)
├── cookies.ts            # Cookie persistence (save/load per session dir)
├── main.ts               # Entry point — CLI args → cli.ts, no args → orchestrator
├── cli.ts                # CLI handler: add-user, remove-user, list-users, status
├── orchestrator.ts       # Multi-tenant orchestrator with shared browser + FSWatcher
├── channels/
│   ├── index.ts           # Factory: creates channel from config
│   ├── telegram.ts        # Telegram Bot API
│   ├── discord.ts         # Discord webhooks with rich embeds
│   └── slack.ts           # Slack webhooks with formatted messages
├── engine/
│   ├── browser.ts         # Puppeteer lifecycle, shared browser, per-user contexts
│   ├── ws-hook.ts         # WebSocket constructor replacement for protobuf interception
│   ├── decoder.ts         # Protobuf frame decoder with deduplication
│   ├── event-parser.ts    # DecodedMessage → BaleEvent conversion
│   ├── call-detector.ts   # DOM MutationObserver for call modals
│   └── monitor.ts         # Per-user monitor with reconnect, re-login, dispatch
└── setup/
    ├── wizard.ts          # Terminal setup wizard with channel validation
    └── novnc.ts           # noVNC + Xvfb management (shared Xvfb, per-user sessions)
```
