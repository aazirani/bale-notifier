# Robustness Overhaul — Design Spec

Date: 2026-05-11

## Problem Statement

The multi-tenant Bale Notifier has 17 identified issues preventing notifications from being sent and making the system fragile. The user can add users but receives no notifications. The root causes span session persistence, workflow logic, monitoring engine robustness, and dead/inconsistent code.

## Fix 1: Session Persistence — Save and Restore localStorage

**Files:** `src/engine/browser.ts`, `src/engine/monitor.ts`

**Current:** `createUserContext()` creates a browser context and restores only cookies. Bale stores WebSocket auth tokens in localStorage, which is lost.

**Change:**
- Add `saveLocalStorage(page, sessionDir)` — extracts all localStorage entries and writes to `{sessionDir}/local-storage.json`
- Add `loadLocalStorage(page, sessionDir)` — after page navigation and before the session starts, inject saved localStorage entries via `page.evaluate()`
- Call `loadLocalStorage` in `createUserContext()` after `navigateToBale()`
- Call `saveLocalStorage` in the context's `close()` function alongside cookie saving
- Use the same pattern in `handleRelogin()`: save localStorage after re-login completes

**Storage format:**
```json
{
  "entries": [
    { "key": "someKey", "value": "someValue" },
    ...
  ]
}
```

## Fix 2: Server IP First — Restructure Wizard Flow

**Files:** `src/cli.ts`, `src/setup/wizard.ts`, `src/config.ts`

**Current:** Server IP is Step 4 (last). Saved in user config, not master.json.

**Change:**
- `add-user` in `cli.ts` checks for `master.json` before starting the wizard
- If `master.json` doesn't exist, ask for server IP first and save to `master.json`
- If `master.json` exists, confirm the server IP or allow update
- Remove Step 4 (server IP) from the wizard entirely
- The wizard receives the server IP as a parameter (from cli.ts, which reads master.json)
- Remove `noVncUrl` from `AppConfig.bale` (it's dead data — the orchestrator constructs URLs at runtime)
- `AppConfig.bale` becomes just `{ sessionDir: string }`

## Fix 3: Decoder Logging

**Files:** `src/engine/monitor.ts`

**Current:** When `decoder.decode()` returns null, nothing is logged.

**Change:**
- When decode returns null, log a debug message with the frame size and first 8 bytes as hex
- This makes it possible to diagnose why protobuf parsing fails

## Fix 4: NoVNC Port in Re-login

**Files:** `src/setup/wizard.ts`, `src/types.ts`

**Current:** Wizard saves `noVncUrl` with port 6080 (wrong). Orchestrator constructs correct URL at runtime.

**Change:**
- Remove `noVncUrl` from `AppConfig`
- The orchestrator already uses the correct port from `allocatePort()` + `masterConfig.serverIp`
- The wizard no longer saves or uses this field

## Fix 5: Re-login Loop Protection

**Files:** `src/engine/monitor.ts`

**Current:** After re-login timeout, the monitor retries indefinitely with no cap.

**Change:**
- Add `reloginAttempts` counter to `BaleMonitor`
- After 3 consecutive failed re-login attempts, enter a cooldown (default: 30 minutes)
- During cooldown, send a notification: "Session expired. Manual re-login required. Monitoring paused for 30 minutes."
- Reset the counter on successful re-login

## Fix 6: Xvfb Safety in Re-login

**Files:** `src/engine/monitor.ts`, `src/setup/novnc.ts`

**Current:** `handleRelogin` launches a browser with `headless: false` assuming Xvfb is running. If noVNC failed to start, the display doesn't exist and the browser crashes.

**Change:**
- `handleRelogin` checks if Xvfb/noVNC started successfully before launching a headed browser
- If noVNC failed, fall back to headless mode (user can't interact, but at least it doesn't crash)
- Log a warning that re-login requires manual intervention when noVNC is unavailable

## Fix 7: Re-login Uses Shared Browser

**Files:** `src/engine/monitor.ts`

**Current:** `handleRelogin` calls `puppeteer.launch()` — creates a new browser process.

**Change:**
- When noVNC is not needed (non-headless or noVNC failed), use the shared browser with a new context
- Only launch a separate browser when noVNC is active (user needs to interact with the display)
- Save cookies + localStorage after re-login completes (same as Fix 1)

## Fix 8: Persistent Port Allocation

**Files:** `src/orchestrator.ts`, `src/types.ts`, `src/config.ts`

**Current:** Ports allocated by sorted directory position. Removing a user shifts all subsequent ports.

**Change:**
- Add `userPorts: Record<string, number>` to `MasterConfig`
- `allocatePort()` checks the map first; if user has no assigned port, finds the next available port in the range
- When a user is removed, their port entry stays in the map (it'll be reused if the same user is re-added, or can be manually cleaned up)
- `master.json` is updated when ports are allocated

**Example master.json:**
```json
{
  "serverIp": "192.168.1.100",
  "novncPortRange": [6081, 6090],
  "loginTimeoutMinutes": 15,
  "userPorts": {
    "alice": 6081,
    "bob": 6082
  }
}
```

## Fix 9: Channel Validation in Wizard

**Files:** `src/setup/wizard.ts`, `src/channels/index.ts`

**Current:** `validateConfig()` exists on channels but is never called.

**Change:**
- After collecting channel credentials in the wizard, create the channel and call `validateConfig()`
- If validation fails, show the error and offer to retry (re-enter credentials)
- This catches bad bot tokens and unreachable webhooks immediately

## Fix 10: FSWatcher Debounce

**Files:** `src/orchestrator.ts`

**Current:** `fs.watch()` callback fires immediately on directory creation, before config.json is written.

**Change:**
- Debounce `onUsersDirChange()` with a 2-second delay
- After the debounce, validate that `config.json` exists and is valid JSON before calling `startUser()`
- Log a warning if a directory exists without a valid config

## Fix 11: Session Save Validation

**Files:** `src/setup/wizard.ts`

**Current:** No check that the Bale session was actually saved after browser close.

**Change:**
- After `browser.close()`, check that the session directory contains at least one file
- If the directory is empty, warn the user and offer to retry

## Fix 12: Docker Port Cleanup

**Files:** `docker-compose.yml`

**Current:** Maps port 6080 (unused) plus 6081-6090.

**Change:**
- Remove `6080:6080` mapping
- Keep `6081-6090:6081-6090`
- Add a comment explaining the port range is for per-user noVNC

## Summary of Changes by File

| File | Fixes |
|------|-------|
| `src/engine/browser.ts` | Fix 1 (localStorage save/load) |
| `src/engine/monitor.ts` | Fix 1, 3, 5, 6, 7 (localStorage, decoder logging, re-login loop, Xvfb safety, shared browser) |
| `src/setup/wizard.ts` | Fix 2, 4, 9, 11 (flow restructure, remove noVncUrl, channel validation, session validation) |
| `src/setup/novnc.ts` | Fix 6 (expose Xvfb status) |
| `src/cli.ts` | Fix 2 (master.json init before wizard) |
| `src/config.ts` | Fix 2, 8 (master config helpers, port map) |
| `src/types.ts` | Fix 4, 8 (remove noVncUrl, add userPorts) |
| `src/orchestrator.ts` | Fix 8, 10 (persistent ports, FSWatcher debounce) |
| `src/channels/index.ts` | Fix 9 (expose validate helper) |
| `docker-compose.yml` | Fix 12 (remove port 6080) |

## Implementation Order

1. **Fix 1** (localStorage persistence) — foundation for everything else
2. **Fix 2** (wizard flow) — structural change, affects many files
3. **Fix 8** (persistent ports) — structural change, affects orchestrator + config
4. **Fix 4** (remove noVncUrl) — cleanup after Fix 2
5. **Fix 3** (decoder logging) — small, standalone
6. **Fix 5** (re-login loop protection) — depends on Fix 1
7. **Fix 6** (Xvfb safety) — small, standalone
8. **Fix 7** (shared browser in re-login) — depends on Fix 1
9. **Fix 9** (channel validation) — small, standalone
10. **Fix 10** (FSWatcher debounce) — small, standalone
11. **Fix 11** (session validation) — small, standalone
12. **Fix 12** (Docker cleanup) — last, config only
