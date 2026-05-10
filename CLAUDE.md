# Bale Notifier

Docker-packaged notification forwarder that monitors web.bale.ai for new messages and calls, then pushes them to Telegram/Discord/Slack.

## Architecture

- **Setup Wizard** (`src/setup/wizard.ts`) — Terminal CLI using Inquirer.js. Opens browser for Bale auth, configures output channel, saves to `/data/config.json`
- **Notification Engine** (`src/engine/`) — Headless Chromium with MutationObserver detects incoming calls (ReactModal__Overlay) and new messages (unread badge changes). Routes events to output channels.
- **Output Channels** (`src/channels/`) — Pluggable targets implementing `NotificationChannel` interface. Supported: Telegram, Discord, Slack.
- **noVNC** (`src/setup/novnc.ts`) — Xvfb + x11vnc + websockify for remote browser access on headless servers

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

## Commands

- `npm run build` — Compile TypeScript
- `npm start` — Run the notifier (needs `/data/config.json` or launches setup wizard)
- `npm test` — Run vitest suite
- `npm run test:watch` — Run tests in watch mode

## Testing

Tests use vitest. Channel tests mock their APIs (Telegram bot, global fetch for Discord/Slack). Config tests use temp directories. Event parser tests cover DOM notification parsing.

## Docker

```bash
docker compose up --build
# Port 6080 for noVNC (Bale auth on headless servers)
# Volume: ./data:/data (config + session persistence)
```

## Project Structure

```
src/
├── types.ts              # BaleEvent, DomNotification, AppConfig, NotificationChannel interface
├── config.ts             # Load/save/validate config from disk
├── main.ts               # Entry point — wizard or monitor based on config
├── channels/
│   ├── index.ts           # Factory: creates channel from config
│   ├── telegram.ts        # Telegram Bot API
│   ├── discord.ts         # Discord webhooks with rich embeds
│   └── slack.ts           # Slack webhooks with formatted messages
├── engine/
│   ├── browser.ts         # Puppeteer lifecycle + Bale navigation
│   ├── ws-interceptor.ts  # DOM MutationObserver via page.exposeFunction
│   ├── event-parser.ts     # DomNotification → BaleEvent conversion
│   └── monitor.ts         # Orchestrator with reconnect + dispatch
└── setup/
    ├── wizard.ts          # Terminal setup wizard
    └── novnc.ts           # noVNC + Xvfb management
```
