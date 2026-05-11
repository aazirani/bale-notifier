# Single Shared Browser Multi-Tenant Architecture

## Problem

The current architecture runs one Docker container per user, each launching its own Chromium instance (~300-600MB RAM). Running 5-10 users on a 2-4GB server is impractical — 10 users would need 3-6GB just for browsers.

## Solution

Replace per-user containers with a **single container running one shared Chromium instance**, using Puppeteer browser contexts for per-user session isolation. Expected resource usage: ~700MB for 10 users.

## Architecture

```
┌─────────────────────────────────────────┐
│            Single Docker Container       │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │         Chromium (shared)          │  │
│  │  ┌──────┐ ┌──────┐ ┌──────┐       │  │
│  │  │Ctx 1 │ │Ctx 2 │ │Ctx 3 │ ...   │  │
│  │  │Bale  │ │Bale  │ │Bale  │       │  │
│  │  │page  │ │page  │ │page  │       │  │
│  │  └──────┘ └──────┘ └──────┘       │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │       Multi-Tenant Orchestrator    │  │
│  │  - User lifecycle management       │  │
│  │  - Per-user config & state         │  │
│  │  - Notification dispatch           │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌──────────────┐  ┌──────────────────┐  │
│  │ Config Store  │  │ noVNC (on-demand)│  │
│  │ /data/users/  │  │ only for login   │  │
│  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────┘
```

### Key Changes from Current Architecture

| Aspect | Current | New |
|--------|---------|-----|
| Containers | One per user | Single container |
| Chromium instances | One per user | One shared |
| RAM per user | ~300-600MB | ~20-30MB (plus ~400MB shared browser) |
| noVNC | Always running per user | On-demand, shared port |
| Config | `/data/config.json` | `/data/users/{id}/config.json` |
| User management | Manual container duplication | CLI commands |

## User Lifecycle

### Adding a User

1. Admin runs `docker compose exec bale-notifier bale add-user`
2. System creates a browser context with isolated storage
3. noVNC starts temporarily for that user
4. User logs into Bale via noVNC
5. System saves session cookies to `/data/users/{userId}/session/`
6. noVNC shuts down; user's page begins monitoring

### Monitoring (Per User)

- Each user has a `UserSession` object managing its browser page, config, and state
- The orchestrator runs all sessions concurrently via async operations
- If one session drops, only that user's page reconnects — others unaffected
- Reconnection uses exponential backoff (1s → 60s max), same as today

### Re-login (Rare)

- When Bale session expires, system detects it via the same DOM check used today
- noVNC starts on a dynamically allocated port
- User receives a notification via their configured channel with the noVNC URL
- After login completes, noVNC shuts down

### Removing a User

- Admin runs `docker compose exec bale-notifier bale remove-user`
- Browser context closes, session data removed

## Configuration & Storage

```
/data/
├── users/
│   ├── user1/
│   │   ├── config.json      # Channel config, preferences
│   │   └── session/          # Chrome user data (cookies, local storage)
│   ├── user2/
│   │   ├── config.json
│   │   └── session/
│   └── ...
├── master.json              # Global settings (server IP, noVNC port range, log level)
└── state.json               # Runtime state (active sessions, last ping)
```

- Each user's `config.json` uses the same channel format as today (Telegram bot token + chat ID, Discord webhook URL, Slack webhook URL)
- `master.json` holds global settings: server IP for noVNC URLs, noVNC port range, log level
- `state.json` tracks active sessions, last reconnect timestamps — survives container restarts
- On container restart, all configured users auto-resume from saved sessions

## Error Handling & Isolation

### User Isolation

- Each browser context is sandboxed via Puppeteer's `browser.newContext()` — cookies, storage, sessions are fully isolated
- Notification channels are independent — one user's broken Telegram bot doesn't affect another's Discord webhook
- A single page crash only affects that user; others continue uninterrupted

### Failure Scenarios

- **Chromium crash**: All users lose pages. Orchestrator restarts Chromium, recreates all contexts, reconnects from saved state.
- **Single page crash**: Only that user reconnects with exponential backoff.
- **Session expiry**: User is notified via their channel; noVNC starts for re-login.
- **Container restart**: All sessions resume from saved cookies on startup.

### Monitoring

- Each user session has a health check (periodic WebSocket keepalive)
- Orchestrator logs per-user status: connected, reconnecting, needs-login
- Optional HTTP health endpoint reporting all user statuses

## Docker & Deployment

### Compose File

```yaml
services:
  bale-notifier:
    build: .
    ports:
      - "6080:6080"  # noVNC (on-demand)
    volumes:
      - ./data:/data
    environment:
      - NOVNC_PORT=6080
      - DISPLAY=:99
    deploy:
      resources:
        limits:
          memory: 2G
    restart: unless-stopped
```

### CLI Commands

A `bale` shell wrapper (`/usr/local/bin/bale`) maps subcommands:

```bash
bale add-user       # Start user setup (opens noVNC for Bale login)
bale remove-user    # Remove a user and their session data
bale list-users     # Show all configured users and their status
bale status         # Health check — overall and per-user
```

Usage:
```bash
docker compose exec bale-notifier bale add-user
docker compose exec bale-notifier bale list-users
```

With a shell alias: `alias bale='docker compose exec bale-notifier bale'`

### Upgrade Path

- Existing single-user `/data/config.json` is auto-migrated to `/data/users/default/config.json` on first run
- No manual migration needed for existing deployments

## Resource Estimates

| Metric | 10 Users (Current) | 10 Users (New) |
|--------|-------------------|----------------|
| RAM | 3-6 GB | ~700 MB |
| Containers | 10 | 1 |
| Chromium processes | 10 | 1 |
| noVNC instances | 10 (always running) | 1 (on-demand) |
| Docker image layers | 10× shared | 1× |

## Testing

### Existing Tests (No Changes)

- Channel tests (mocked Telegram/Discord/Slack APIs)
- Config tests (temp directories)
- Event parser tests (DOM notification parsing)

### New Tests

- **Orchestrator tests**: Verify multiple users start/stop independently
- **Browser context isolation**: Verify cookies/storage don't leak between users
- **Multi-user config loading**: Test discovery from `/data/users/`
- **CLI commands**: Test add-user, remove-user, list-users against temp data dirs

All new tests mock Puppeteer (no real browser in CI), following existing test patterns.

## Scope

This design covers the multi-tenant architecture refactor. It does not include:
- New notification channels (only reuses existing Telegram/Discord/Slack)
- Two-way messaging (forwarding only, same as today)
- Admin web UI (CLI-only management)
- Horizontal scaling across multiple servers
