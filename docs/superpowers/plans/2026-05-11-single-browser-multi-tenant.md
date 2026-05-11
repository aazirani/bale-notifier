# Single Shared Browser Multi-Tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Bale Notifier from per-user containers to a single container with one shared Chromium instance using Puppeteer browser contexts.

**Architecture:** One Node.js process launches a shared headless Chromium. Each user gets an isolated browser context (separate cookies/storage). An orchestrator manages all user sessions, discovers users from the filesystem, and auto-starts monitors. noVNC runs on-demand with per-user ports for re-login. CLI commands communicate via the filesystem (no IPC).

**Tech Stack:** TypeScript, Puppeteer (browser contexts), Node.js, vitest

---

## File Structure

### New Files
| File | Purpose |
|------|---------|
| `src/cookies.ts` | Cookie save/load for browser contexts |
| `src/orchestrator.ts` | Multi-tenant session manager |
| `src/cli.ts` | CLI subcommand handler (add-user, remove-user, list-users, status) |
| `bin/bale` | Shell wrapper script for CLI |
| `tests/cookies.test.ts` | Cookie persistence tests |
| `tests/orchestrator.test.ts` | Orchestrator unit tests |
| `tests/config-multi.test.ts` | Multi-user config tests |

### Modified Files
| File | Changes |
|------|---------|
| `src/types.ts` | Add `MasterConfig`, `UserState`, `relogin` event type |
| `src/constants.ts` | Add multi-tenant constants |
| `src/config.ts` | Add `discoverUsers`, `loadMasterConfig`, `saveMasterConfig`, `migrateSingleToMulti` |
| `src/engine/browser.ts` | Add `launchSharedBrowser`, `createUserContext`, `launchReloginBrowser` |
| `src/engine/monitor.ts` | Accept shared `Browser` + `userId`, use contexts, use `NoVncSession` |
| `src/setup/wizard.ts` | Fix `sessionDirFromConfigPath` bug, accept userId parameter |
| `src/setup/novnc.ts` | Rewrite as `NoVncSession` class with per-user ports and token auth |
| `src/main.ts` | Refactor: start orchestrator or delegate to CLI |
| `docker-compose.yml` | Single service with port range |
| `Dockerfile` | Port range, `bale` wrapper, entrypoint script |

### Unchanged Files
- `src/channels/*` — Instance-based, already isolated per user
- `src/engine/ws-hook.ts` — Scoped to page, works with contexts
- `src/engine/call-detector.ts` — Scoped to page via `page.exposeFunction`
- `src/engine/event-parser.ts` — Pure function, no state
- `src/engine/decoder.ts` — Instance-based, already isolated
- `src/engine/protobuf/*` — Stateless schema definitions
- `src/logger.ts` — No changes needed

---

### Task 1: Multi-Tenant Types & Constants

**Files:**
- Modify: `src/types.ts`
- Modify: `src/constants.ts`

- [ ] **Step 1: Add multi-tenant types to `src/types.ts`**

Append after the existing `DecodedMessage` interface:

```typescript
// --- Multi-Tenant Types ---

export interface MasterConfig {
  serverIp: string;
  novncPortRange: [number, number];
  loginTimeoutMinutes: number;
  logLevel?: string;
}

export type UserStatus = "starting" | "running" | "reconnecting" | "needs-login" | "stopped";

export interface UserState {
  userId: string;
  status: UserStatus;
  lastPing?: string;
  lastReconnect?: string;
}
```

Also update `BaleEventType` on line 3 to add the relogin notification type:

```typescript
export type BaleEventType = "message" | "call" | "group_notification" | "relogin";
```

- [ ] **Step 2: Add multi-tenant constants to `src/constants.ts`**

Append after the existing `PREVIEW_MAX_LENGTH` constant:

```typescript
// Multi-Tenant
export const DEFAULT_USERS_DIR = "/data/users";
export const DEFAULT_MASTER_CONFIG_PATH = "/data/master.json";
export const DEFAULT_STATE_PATH = "/data/state.json";
export const DEFAULT_NOVNC_PORT_RANGE: [number, number] = [6081, 6090];
export const DEFAULT_LOGIN_TIMEOUT_MINUTES = 15;
export const STATE_SAVE_INTERVAL_MS = 30_000;
```

- [ ] **Step 3: Commit**

```bash
git add src/types.ts src/constants.ts
git commit -m "feat: add multi-tenant types (MasterConfig, UserState) and constants"
```

---

### Task 2: Multi-User Config Functions

**Files:**
- Modify: `src/config.ts`
- Create: `tests/config-multi.test.ts`

- [ ] **Step 1: Write failing tests for multi-user config in `tests/config-multi.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  discoverUsers,
  loadMasterConfig,
  saveMasterConfig,
  loadUserConfig,
  saveUserConfig,
  migrateSingleToMulti,
} from "../src/config.js";
import type { AppConfig, MasterConfig } from "../src/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bale-multi-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("discoverUsers", () => {
  it("returns empty array when users dir does not exist", () => {
    expect(discoverUsers(path.join(tmpDir, "no-such-dir"))).toEqual([]);
  });

  it("returns empty array for users dir with no configs", () => {
    const usersDir = path.join(tmpDir, "users");
    fs.mkdirSync(path.join(usersDir, "empty-dir"), { recursive: true });
    expect(discoverUsers(usersDir)).toEqual([]);
  });

  it("returns user IDs for directories with config.json", () => {
    const usersDir = path.join(tmpDir, "users");
    fs.mkdirSync(path.join(usersDir, "alice"), { recursive: true });
    fs.mkdirSync(path.join(usersDir, "bob"), { recursive: true });
    fs.writeFileSync(
      path.join(usersDir, "alice", "config.json"),
      JSON.stringify({ bale: { sessionDir: "/a" } }),
    );
    fs.writeFileSync(
      path.join(usersDir, "bob", "config.json"),
      JSON.stringify({ bale: { sessionDir: "/b" } }),
    );
    const users = discoverUsers(usersDir);
    expect(users.sort()).toEqual(["alice", "bob"]);
  });
});

describe("loadMasterConfig and saveMasterConfig", () => {
  it("round-trips a master config", () => {
    const configPath = path.join(tmpDir, "master.json");
    const config: MasterConfig = {
      serverIp: "203.0.113.10",
      novncPortRange: [6081, 6090],
      loginTimeoutMinutes: 15,
    };
    saveMasterConfig(configPath, config);
    const loaded = loadMasterConfig(configPath);
    expect(loaded).toEqual(config);
  });

  it("returns default master config when file does not exist", () => {
    const loaded = loadMasterConfig(path.join(tmpDir, "missing.json"));
    expect(loaded.serverIp).toBe("localhost");
    expect(loaded.novncPortRange).toEqual([6081, 6090]);
    expect(loaded.loginTimeoutMinutes).toBe(15);
  });
});

describe("loadUserConfig and saveUserConfig", () => {
  it("round-trips a user config", () => {
    const usersDir = path.join(tmpDir, "users");
    const config: AppConfig = {
      bale: { sessionDir: "/data/users/alice/session", noVncUrl: "" },
      channel: { type: "telegram", telegram: { botToken: "123:ABC", chatId: 999 } },
      notifications: { messages: true, calls: true, groups: true },
    };
    saveUserConfig(usersDir, "alice", config);
    const loaded = loadUserConfig(usersDir, "alice");
    expect(loaded).toEqual(config);
  });
});

describe("migrateSingleToMulti", () => {
  it("migrates existing single-user config to multi-user structure", () => {
    const dataDir = tmpDir;
    const singleConfig: AppConfig = {
      bale: { sessionDir: "/data/bale-session", noVncUrl: "http://1.2.3.4:6080/vnc.html" },
      channel: { type: "telegram", telegram: { botToken: "t", chatId: 1 } },
      notifications: { messages: true, calls: true, groups: true },
    };
    fs.writeFileSync(
      path.join(dataDir, "config.json"),
      JSON.stringify(singleConfig),
    );

    migrateSingleToMulti(dataDir);

    const usersDir = path.join(dataDir, "users");
    expect(fs.existsSync(path.join(usersDir, "default", "config.json"))).toBe(true);
    const loaded = loadUserConfig(usersDir, "default");
    expect(loaded.channel.type).toBe("telegram");
    // Original single-user config should be removed
    expect(fs.existsSync(path.join(dataDir, "config.json"))).toBe(false);
  });

  it("does nothing if no single-user config exists", () => {
    const dataDir = tmpDir;
    migrateSingleToMulti(dataDir);
    expect(fs.existsSync(path.join(dataDir, "users"))).toBe(false);
  });

  it("does nothing if multi-user structure already exists", () => {
    const dataDir = tmpDir;
    fs.mkdirSync(path.join(dataDir, "users", "alice"), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "config.json"),
      JSON.stringify({ bale: {} }),
    );
    migrateSingleToMulti(dataDir);
    // Should NOT have moved config.json since users/ already exists
    expect(fs.existsSync(path.join(dataDir, "config.json"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config-multi.test.ts`
Expected: FAIL — `discoverUsers` and other functions not found

- [ ] **Step 3: Implement multi-user config functions in `src/config.ts`**

Add these imports at the top of `src/config.ts` (add `readdirSync` to the existing `fs` import and add type imports):

```typescript
import fs from "node:fs";
import path from "node:path";
import type { AppConfig, MasterConfig } from "./types.js";
import { DEFAULT_NOVNC_PORT_RANGE, DEFAULT_LOGIN_TIMEOUT_MINUTES } from "./constants.js";
```

Append these functions after the existing `isValidUrl` function:

```typescript
// --- Multi-User Config Functions ---

export function discoverUsers(usersDir: string): string[] {
  if (!fs.existsSync(usersDir)) return [];
  const entries = fs.readdirSync(usersDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(usersDir, e.name, "config.json")))
    .map((e) => e.name);
}

export function loadMasterConfig(configPath: string): MasterConfig {
  if (!fs.existsSync(configPath)) {
    return {
      serverIp: "localhost",
      novncPortRange: DEFAULT_NOVNC_PORT_RANGE,
      loginTimeoutMinutes: DEFAULT_LOGIN_TIMEOUT_MINUTES,
    };
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as MasterConfig;
}

export function saveMasterConfig(configPath: string, config: MasterConfig): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export function loadUserConfig(usersDir: string, userId: string): AppConfig {
  const configPath = path.join(usersDir, userId, "config.json");
  return loadConfig(configPath);
}

export function saveUserConfig(usersDir: string, userId: string, config: AppConfig): void {
  const configPath = path.join(usersDir, userId, "config.json");
  saveConfig(configPath, config);
}

export function migrateSingleToMulti(dataDir: string): void {
  const singleConfigPath = path.join(dataDir, "config.json");
  const usersDir = path.join(dataDir, "users");

  // Don't migrate if no single config or multi-user structure already exists
  if (!fs.existsSync(singleConfigPath) || fs.existsSync(usersDir)) return;

  const config = loadConfig(singleConfigPath);
  saveUserConfig(usersDir, "default", config);
  fs.unlinkSync(singleConfigPath);
}
```

Note: The existing `saveConfig` uses `configPath.substring(0, configPath.lastIndexOf("/"))` to get the directory. This works with the new paths too (`/data/users/alice/config.json` → `/data/users/alice`). No change needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config-multi.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config-multi.test.ts
git commit -m "feat: add multi-user config functions (discoverUsers, loadMasterConfig, migrateSingleToMulti)"
```

---

### Task 3: Cookie Persistence

**Files:**
- Create: `src/cookies.ts`
- Create: `tests/cookies.test.ts`

Browser contexts don't auto-persist cookies like `userDataDir` does. We need explicit save/load to maintain sessions across context recreations.

- [ ] **Step 1: Write failing tests in `tests/cookies.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { saveCookies, loadCookies } from "../src/cookies.js";
import type { Protocol } from "puppeteer";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bale-cookies-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const sampleCookies: Protocol.Network.Cookie[] = [
  {
    name: "session",
    value: "abc123",
    domain: ".bale.ai",
    path: "/",
    expires: -1,
    size: 15,
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  },
  {
    name: "token",
    value: "xyz789",
    domain: ".bale.ai",
    path: "/",
    expires: -1,
    size: 14,
    httpOnly: true,
    secure: true,
    sameSite: "None",
  },
];

describe("saveCookies and loadCookies", () => {
  it("round-trips cookies to disk", async () => {
    await saveCookies(sampleCookies, tmpDir);
    const loaded = await loadCookies(tmpDir);
    expect(loaded).toEqual(sampleCookies);
  });

  it("creates the directory if it does not exist", async () => {
    const cookieDir = path.join(tmpDir, "sub", "dir");
    await saveCookies(sampleCookies, cookieDir);
    const loaded = await loadCookies(cookieDir);
    expect(loaded).toEqual(sampleCookies);
  });

  it("returns empty array when no cookie file exists", async () => {
    const loaded = await loadCookies(tmpDir);
    expect(loaded).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cookies.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/cookies.ts`**

```typescript
import fs from "node:fs";
import path from "node:path";
import type { Protocol } from "puppeteer";

const COOKIES_FILE = "cookies.json";

export async function saveCookies(
  cookies: Protocol.Network.Cookie[],
  dir: string,
): Promise<void> {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, COOKIES_FILE);
  fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2), "utf-8");
}

export async function loadCookies(
  dir: string,
): Promise<Protocol.Network.Cookie[]> {
  const filePath = path.join(dir, COOKIES_FILE);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as Protocol.Network.Cookie[];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cookies.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cookies.ts tests/cookies.test.ts
git commit -m "feat: add cookie persistence for browser contexts"
```

---

### Task 4: NoVNC Session Class

**Files:**
- Modify: `src/setup/novnc.ts`
- Create: `tests/novnc.test.ts`

Rewrite from module-level singletons to a class with per-user port allocation and token auth. Xvfb is managed as a shared resource — started once, reused by all sessions.

- [ ] **Step 1: Write failing tests in `tests/novnc.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NoVncSession } from "../src/setup/novnc.js";

// Mock child_process
const mockProcs: { kill: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; stderr: { on: ReturnType<typeof vi.fn>; removeAllListeners: ReturnType<typeof vi.fn> } }[] = [];

vi.mock("node:child_process", () => ({
  spawn: vi.fn((..._args: unknown[]) => {
    const proc = {
      kill: vi.fn(),
      on: vi.fn(),
      stderr: {
        on: vi.fn(),
        removeAllListeners: vi.fn(),
      },
    };
    mockProcs.push(proc);
    return proc;
  }),
}));

beforeEach(() => {
  mockProcs.length = 0;
});

describe("NoVncSession", () => {
  it("starts x11vnc and websockify on the specified port", async () => {
    const session = new NoVncSession(6081, 5901);
    const url = await session.start();

    expect(url).toContain(":6081");
    expect(url).toContain("token=");
    // 2 processes: x11vnc + websockify (Xvfb is shared, not per-session)
    expect(mockProcs.length).toBeGreaterThanOrEqual(2);
  });

  it("returns a URL with a random token", async () => {
    const session = new NoVncSession(6082, 5902);
    const url1 = await session.start();
    // Token should be present and 16+ chars hex
    const token = new URL(url1).searchParams.get("token");
    expect(token).toBeTruthy();
    expect(token!.length).toBeGreaterThanOrEqual(16);
  });

  it("kills x11vnc and websockify on stop", async () => {
    const session = new NoVncSession(6083, 5903);
    await session.start();
    const procsAtStart = mockProcs.length;
    session.stop();
    // All processes spawned by this session should be killed
    expect(mockProcs[procsAtStart - 2].kill).toHaveBeenCalled();
    expect(mockProcs[procsAtStart - 1].kill).toHaveBeenCalled();
  });

  it("generates different tokens for different sessions", async () => {
    const s1 = new NoVncSession(6084, 5904);
    const url1 = await s1.start();
    s1.stop();

    const s2 = new NoVncSession(6085, 5905);
    const url2 = await s2.start();
    s2.stop();

    const token1 = new URL(url1).searchParams.get("token");
    const token2 = new URL(url2).searchParams.get("token");
    expect(token1).not.toBe(token2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/novnc.test.ts`
Expected: FAIL — `NoVncSession` is not exported

- [ ] **Step 3: Rewrite `src/setup/novnc.ts`**

Replace the entire file content:

```typescript
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { logger } from "../logger.js";
import { XVFB_SCREEN, NOVNC_STARTUP_DELAY_MS, NOVNC_WEBSOCKIFY_DELAY_MS } from "../constants.js";

const DISPLAY = process.env.DISPLAY || ":99";

// Shared Xvfb — started once, reused by all NoVncSessions
let sharedXvfb: ChildProcess | null = null;
let xvfbStarted = false;

async function ensureXvfb(): Promise<void> {
  if (xvfbStarted) return;
  xvfbStarted = true;

  try {
    sharedXvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", XVFB_SCREEN], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    sharedXvfb.on("error", (err) => logger.debug(`[noVNC] Xvfb error: ${err.message}`));
    await sleep(NOVNC_STARTUP_DELAY_MS);
    logger.info("[noVNC] Xvfb: Started");
  } catch {
    // Xvfb may already be running (e.g., started by the main process)
    logger.debug("[noVNC] Xvfb already running or failed to start");
  }
}

export class NoVncSession {
  private x11vnc: ChildProcess | null = null;
  private websockify: ChildProcess | null = null;
  private token = crypto.randomBytes(16).toString("hex");

  constructor(
    private readonly port: number,
    private readonly vncPort: number,
  ) {}

  async start(): Promise<string> {
    await ensureXvfb();

    logger.info(`[noVNC] x11vnc: Starting on VNC port ${this.vncPort}...`);
    this.x11vnc = spawn("x11vnc", [
      "-display", DISPLAY,
      "-nopw",
      "-listen", "localhost",
      "-forever",
      "-rfbport", String(this.vncPort),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    this.x11vnc.on("error", (err) => logger.debug(`[noVNC] x11vnc error: ${err.message}`));
    this.x11vnc.stderr?.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line.includes("listen") || line.includes("port") || line.includes("error")) {
        logger.info(`[noVNC] x11vnc: ${line}`);
      }
    });
    await sleep(NOVNC_STARTUP_DELAY_MS);

    logger.info(`[noVNC] websockify: Starting on port ${this.port}...`);
    this.websockify = spawn("websockify", [
      "--web", "/usr/share/novnc",
      String(this.port),
      `localhost:${this.vncPort}`,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    this.websockify.on("error", (err) => logger.debug(`[noVNC] websockify error: ${err.message}`));
    this.websockify.stderr?.on("data", (d: Buffer) => {
      logger.info(`[noVNC] websockify: ${d.toString().trim()}`);
    });
    await sleep(NOVNC_WEBSOCKIFY_DELAY_MS);

    return `http://localhost:${this.port}/vnc.html?autoconnect=true&token=${this.token}`;
  }

  stop(): void {
    this.x11vnc?.stderr?.removeAllListeners();
    this.websockify?.stderr?.removeAllListeners();
    this.websockify?.kill();
    this.x11vnc?.kill();
    this.websockify = null;
    this.x11vnc = null;
  }

  get display(): string {
    return DISPLAY;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

Also export the legacy functions for backward compatibility during the transition (the wizard still uses these during `add-user`):

```typescript
// Legacy single-user functions (used by wizard during add-user)
export async function startNoVnc(): Promise<string> {
  const port = Number(process.env.NOVNC_PORT) || 6080;
  const vncPort = Number(process.env.VNC_PORT) || 5900;
  const session = new NoVncSession(port, vncPort);
  activeLegacySession = session;
  return session.start();
}

export function stopNoVnc(): void {
  activeLegacySession?.stop();
  activeLegacySession = null;
}

let activeLegacySession: NoVncSession | null = null;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/novnc.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/setup/novnc.ts tests/novnc.test.ts
git commit -m "feat: rewrite noVNC as NoVncSession class with per-user ports and token auth"
```

---

### Task 5: Shared Browser Utilities

**Files:**
- Modify: `src/engine/browser.ts`

Add functions to launch a shared headless browser, create isolated user contexts, and launch temporary visible browsers for re-login.

- [ ] **Step 1: Add shared browser functions to `src/engine/browser.ts`**

Add these imports (merge with existing):

```typescript
import type { Browser, BrowserContext } from "puppeteer";
import type { Protocol } from "puppeteer";
import { loadCookies, saveCookies } from "../cookies.js";
```

Append after the existing `isLoggedIn` function:

```typescript
// --- Shared Browser Functions ---

export async function launchSharedBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: BROWSER_LAUNCH_ARGS,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
}

export async function createUserContext(
  browser: Browser,
  sessionDir: string,
): Promise<{ context: BrowserContext; page: Page; close: () => Promise<void> }> {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });

  // Restore saved cookies
  const cookies = await loadCookies(sessionDir);
  if (cookies.length > 0) {
    await page.setCookie(...cookies);
  }

  const close = async () => {
    // Save cookies before closing
    try {
      const currentCookies = await page.cookies();
      await saveCookies(currentCookies, sessionDir);
    } catch {
      // Page may already be closed
    }
    await context.close();
  };

  return { context, page, close };
}

export async function launchReloginBrowser(
  display: string,
  sessionDir: string,
): Promise<{ browser: Browser; page: Page }> {
  const browser = await puppeteer.launch({
    headless: false,
    args: [...BROWSER_LAUNCH_ARGS, `--display=${display}`],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    env: { ...process.env, DISPLAY: display },
  });

  const page = await browser.newPage();
  await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });

  // Restore cookies so the user sees their Bale session
  const cookies = await loadCookies(sessionDir);
  if (cookies.length > 0) {
    await page.setCookie(...cookies);
  }

  return { browser, page };
}
```

- [ ] **Step 2: Run build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/engine/browser.ts
git commit -m "feat: add shared browser launch, user context creation, and re-login browser"
```

---

### Task 6: Refactor BaleMonitor

**Files:**
- Modify: `src/engine/monitor.ts`

Change the monitor to accept a shared `Browser` instance instead of launching its own. Use browser contexts for session isolation. Use `NoVncSession` for re-login.

- [ ] **Step 1: Refactor `src/engine/monitor.ts`**

Replace the entire file:

```typescript
import type { Browser } from "puppeteer";
import puppeteer from "puppeteer";
import type { AppConfig, BaleEvent, NotificationChannel, DecodedMessage } from "../types.js";
import { createUserContext, navigateToBale, launchReloginBrowser } from "./browser.js";
import { WS_HOOK_SCRIPT } from "./ws-hook.js";
import { FrameDecoder } from "./decoder.js";
import { parseDecodedMessage } from "./event-parser.js";
import { startCallDetection } from "./call-detector.js";
import { createChannel } from "../channels/index.js";
import { NoVncSession } from "../setup/novnc.js";
import { logger } from "../logger.js";
import {
  RECONNECT_INITIAL_BACKOFF_MS,
  RECONNECT_MAX_BACKOFF_MS,
  KEEPALIVE_INTERVAL_MS,
  KEEPALIVE_CHECK_INTERVAL_MS,
  NOTIFICATION_MAX_RETRIES,
  BALE_URL,
  BROWSER_LAUNCH_ARGS,
  NAVIGATION_TIMEOUT_MS,
  SPA_RENDER_TIMEOUT_MS,
  CONTENT_RENDER_TIMEOUT_MS,
  RELOGIN_TIMEOUT_MS,
} from "../constants.js";

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

export class BaleMonitor {
  private channel: NotificationChannel;
  private running = false;
  private backoffMs = RECONNECT_INITIAL_BACKOFF_MS;
  private contextClose: (() => Promise<void>) | null = null;

  constructor(
    private config: AppConfig,
    private sharedBrowser: Browser,
    private userId: string,
    private novncPort: number,
    private vncPort: number,
    private serverIp: string,
  ) {
    this.channel = createChannel(config);
  }

  getStatus(): string {
    if (!this.running) return "stopped";
    return "running";
  }

  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      try {
        await this.runSession();
      } catch (err) {
        logger.error(`[${this.userId}] Monitor error: ${err}`);
        logger.info(`[${this.userId}] Retrying in ${this.backoffMs}ms...`);
        await this.sleep(this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, RECONNECT_MAX_BACKOFF_MS);
      }
    }
  }

  stop(): void {
    this.running = false;
    this.contextClose?.().catch((err) => logger.debug(`[${this.userId}] Context close error:`, err));
  }

  private async runSession(): Promise<void> {
    const session = await createUserContext(this.sharedBrowser, this.config.bale.sessionDir);
    this.contextClose = session.close;

    try {
      // Inject WS hook BEFORE navigating to Bale
      await session.page.evaluateOnNewDocument(WS_HOOK_SCRIPT);

      // Expose the callback for the WS hook to call
      const decoder = new FrameDecoder();
      await session.page.exposeFunction("__baleOnFrame", (rawBytes: number[]) => {
        const bytes = new Uint8Array(rawBytes);
        const decoded = decoder.decode(bytes);
        if (decoded && this.config.notifications.messages) {
          this.handleDecodedMessage(session.page, decoded);
        }
      });

      await navigateToBale(session.page);

      const url = session.page.url();
      const pageText = await session.page.evaluate("document.body.textContent || ''") as string;
      const isLoginPage = url.includes("/login") ||
        pageText.includes("Choosing the option to log in") ||
        pageText.includes("login me") ||
        pageText.includes("زبان");

      if (isLoginPage) {
        // Close context, then handle re-login with a visible browser
        await session.close();
        this.contextClose = null;
        await this.handleRelogin();
        return;
      }

      // Start DOM-based call detection
      const stopCallDetection = await startCallDetection(session.page, async (callerName) => {
        logger.info(`[${this.userId}] Detected: incoming call from ${callerName}`);
        if (this.config.notifications.calls) {
          const event: BaleEvent = {
            type: "call",
            timestamp: new Date(),
            source: `Call from ${callerName}`,
          };
          await this.dispatch(event);
        }
      });

      logger.info(`[${this.userId}] Connected to Bale. Monitoring for notifications...\n`);

      this.backoffMs = RECONNECT_INITIAL_BACKOFF_MS;

      let keepalive: NodeJS.Timeout | null = null;
      let disconnected = false;

      keepalive = setInterval(async () => {
        if (disconnected) return;
        try {
          await session.page.evaluate("document.title");
        } catch {
          disconnected = true;
          session.context.close().catch((err: unknown) => logger.debug(`[${this.userId}] Context close on disconnect:`, err));
        }
      }, KEEPALIVE_INTERVAL_MS);

      await new Promise<void>((resolve) => {
        session.context.on("close", () => {
          logger.info(`[${this.userId}] Browser context closed. Reconnecting...`);
          if (keepalive) clearInterval(keepalive);
          resolve();
        });
        const check = setInterval(() => {
          if (!this.running) {
            clearInterval(check);
            if (keepalive) clearInterval(keepalive);
            resolve();
          }
        }, KEEPALIVE_CHECK_INTERVAL_MS);
      });

      await stopCallDetection();
    } finally {
      if (this.contextClose) {
        await session.close();
        this.contextClose = null;
      }
    }
  }

  private async handleRelogin(): Promise<void> {
    logger.warn(`[${this.userId}] Bale session expired. Starting re-login flow...\n`);

    const headless = !process.env.DISPLAY || process.env.DISPLAY === ":99" || process.env.DISPLAY === "";

    let novncUrl = "";
    let novnc: NoVncSession | null = null;

    if (headless) {
      try {
        novnc = new NoVncSession(this.novncPort, this.vncPort);
        novncUrl = await novnc.start();
        logger.info(`[${this.userId}] noVNC started: ${novncUrl}`);
      } catch (err) {
        logger.warn(`[${this.userId}] Failed to start noVNC:`, err);
      }
    }

    // Notify user with the re-login URL
    const externalUrl = this.serverIp && novncUrl
      ? novncUrl.replace("localhost", this.serverIp)
      : novncUrl;
    try {
      await this.dispatch({
        type: "relogin",
        timestamp: new Date(),
        source: "Bale Notifier",
        preview: `Session expired. Please re-login${externalUrl ? ` via noVNC: ${externalUrl}` : " in the browser window"}. You have 10 minutes.`,
      });
    } catch (err) {
      logger.warn(`[${this.userId}] Failed to send re-login notification:`, err);
    }

    // Launch visible browser for user to interact with the login page
    const display = novnc?.display || process.env.DISPLAY || ":99";
    const { browser, page } = await launchReloginBrowser(display, this.config.bale.sessionDir);

    try {
      await page.goto(BALE_URL, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });

      try {
        await page.waitForFunction(
          `!document.querySelector('.splash-container') && !document.querySelector('.spin')`,
          { timeout: SPA_RENDER_TIMEOUT_MS },
        );
      } catch { /* ignore render timeout */ }

      try {
        await page.waitForFunction(
          `document.querySelectorAll('span, button, input').length > 5`,
          { timeout: CONTENT_RENDER_TIMEOUT_MS },
        );
      } catch { /* ignore content timeout */ }

      logger.info(`[${this.userId}] Waiting for re-login...`);
      await page.waitForFunction(
        `!window.location.pathname.includes('/login') && !document.body.textContent.includes('login me') && !document.body.textContent.includes('زبان')`,
        { timeout: RELOGIN_TIMEOUT_MS },
      );
      logger.info(`[${this.userId}] Re-login successful! Resuming monitoring...\n`);

      // Save cookies from re-login browser
      const { saveCookies } = await import("../cookies.js");
      const cookies = await page.cookies();
      await saveCookies(cookies, this.config.bale.sessionDir);
    } finally {
      await browser.close();
      novnc?.stop();
    }
  }

  private async handleDecodedMessage(_page: unknown, msg: DecodedMessage): Promise<void> {
    try {
      const event = parseDecodedMessage(msg);
      await this.dispatch(event);
    } catch (err) {
      logger.warn(`[${this.userId}] Failed to dispatch event:`, err);
    }
  }

  private async dispatch(event: BaleEvent): Promise<void> {
    for (let attempt = 1; attempt <= NOTIFICATION_MAX_RETRIES; attempt++) {
      try {
        await this.channel.send(event);
        logger.info(`[${this.userId}] [${event.timestamp.toISOString()}] Notified: ${event.type} in ${event.source}`);
        return;
      } catch (err) {
        if (attempt < NOTIFICATION_MAX_RETRIES) {
          logger.warn(`[${this.userId}] Notification attempt ${attempt} failed, retrying in ${RETRY_DELAYS_MS[attempt - 1]}ms...`, err);
          await this.sleep(RETRY_DELAYS_MS[attempt - 1]);
        } else {
          logger.error(`[${this.userId}] Failed to send notification after ${NOTIFICATION_MAX_RETRIES} attempts:`, err);
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

Key changes from original:
1. Constructor takes `sharedBrowser: Browser`, `userId`, `novncPort`, `vncPort`, `serverIp`
2. `runSession()` uses `createUserContext()` instead of `launchBrowser()`
3. Disconnect detection uses `context.on("close")` instead of `browser.on("disconnected")`
4. `handleRelogin()` uses `NoVncSession` with per-user port instead of module-level `startNoVnc()`
5. After re-login, saves cookies from the visible browser to disk
6. All log messages prefixed with `[${this.userId}]`

- [ ] **Step 2: Run build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/engine/monitor.ts
git commit -m "refactor: BaleMonitor accepts shared browser, uses contexts and per-user noVNC"
```

---

### Task 7: Orchestrator

**Files:**
- Create: `src/orchestrator.ts`
- Create: `tests/orchestrator.test.ts`

The orchestrator manages the shared browser, discovers users, creates monitors, and watches for filesystem changes.

- [ ] **Step 1: Write failing tests in `tests/orchestrator.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Orchestrator } from "../src/orchestrator.js";

// Mock puppeteer
const mockContext = {
  newPage: vi.fn(() => ({
    setViewport: vi.fn(),
    evaluateOnNewDocument: vi.fn(),
    exposeFunction: vi.fn(),
    goto: vi.fn(),
    evaluate: vi.fn(() => "logged in content"),
    url: vi.fn(() => "https://web.bale.ai/chats"),
    cookies: vi.fn(() => []),
    setCookie: vi.fn(),
    on: vi.fn(),
    waitForFunction: vi.fn(),
  })),
  close: vi.fn(),
  on: vi.fn(),
};

const mockBrowser = {
  createBrowserContext: vi.fn(() => mockContext),
  close: vi.fn(),
  newPage: vi.fn(),
};

vi.mock("puppeteer", () => ({
  default: {
    launch: vi.fn(() => Promise.resolve(mockBrowser)),
  },
}));

let tmpDir: string;
let usersDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bale-orch-test-"));
  usersDir = path.join(tmpDir, "users");
  fs.mkdirSync(usersDir, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeUserConfig(userId: string) {
  const dir = path.join(usersDir, userId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      bale: { sessionDir: path.join(dir, "session"), noVncUrl: "" },
      channel: { type: "telegram", telegram: { botToken: "t", chatId: 1 } },
      notifications: { messages: true, calls: true, groups: true },
    }),
  );
}

describe("Orchestrator", () => {
  it("discovers users from the users directory", () => {
    writeUserConfig("alice");
    writeUserConfig("bob");
    const orch = new Orchestrator(tmpDir);
    const users = orch.listUsers();
    expect(users.sort()).toEqual(["alice", "bob"]);
  });

  it("allocates ports deterministically by user index", () => {
    writeUserConfig("alice");
    writeUserConfig("bob");
    const orch = new Orchestrator(tmpDir);
    // alice = first user alphabetically → port 6081
    // bob = second → port 6082
    const users = orch.listUsers();
    expect(users).toEqual(["alice", "bob"]);
  });

  it("removes a user and their data", async () => {
    writeUserConfig("alice");
    const orch = new Orchestrator(tmpDir);
    await orch.removeUser("alice");
    expect(fs.existsSync(path.join(usersDir, "alice", "config.json"))).toBe(false);
    expect(orch.listUsers()).toEqual([]);
  });

  it("saves state to state.json", async () => {
    writeUserConfig("alice");
    const orch = new Orchestrator(tmpDir);
    await orch.saveState();
    const statePath = path.join(tmpDir, "state.json");
    expect(fs.existsSync(statePath)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/orchestrator.ts`**

```typescript
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import type { Browser } from "puppeteer";
import type { AppConfig, MasterConfig, UserState } from "./types.js";
import { BaleMonitor } from "./engine/monitor.js";
import { launchSharedBrowser } from "./engine/browser.js";
import {
  discoverUsers,
  loadMasterConfig,
  saveMasterConfig,
  loadUserConfig,
} from "./config.js";
import { logger } from "./logger.js";
import {
  DEFAULT_USERS_DIR,
  DEFAULT_MASTER_CONFIG_PATH,
  DEFAULT_STATE_PATH,
  DEFAULT_NOVNC_PORT_RANGE,
  STATE_SAVE_INTERVAL_MS,
} from "./constants.js";

interface UserSession {
  userId: string;
  config: AppConfig;
  monitor: BaleMonitor;
  status: UserState["status"];
}

export class Orchestrator {
  private browser: Browser | null = null;
  private sessions = new Map<string, UserSession>();
  private masterConfig: MasterConfig;
  private masterConfigPath: string;
  private usersDir: string;
  private statePath: string;
  private stateSaveInterval: NodeJS.Timeout | null = null;
  private watcher: fs.FSWatcher | null = null;

  constructor(dataDir: string = "/data") {
    this.usersDir = path.join(dataDir, "users");
    this.masterConfigPath = path.join(dataDir, "master.json");
    this.statePath = path.join(dataDir, "state.json");
    this.masterConfig = loadMasterConfig(this.masterConfigPath);
  }

  async start(): Promise<void> {
    logger.info("Starting multi-tenant orchestrator...\n");

    // Ensure users directory exists
    if (!fs.existsSync(this.usersDir)) {
      fs.mkdirSync(this.usersDir, { recursive: true });
    }

    // Save master config if it doesn't exist yet
    if (!fs.existsSync(this.masterConfigPath)) {
      saveMasterConfig(this.masterConfigPath, this.masterConfig);
    }

    // Launch shared headless browser
    logger.info("Launching shared headless browser...");
    this.browser = await launchSharedBrowser();
    logger.info("Shared browser launched.\n");

    // Start all discovered users
    const userIds = discoverUsers(this.usersDir);
    for (const userId of userIds) {
      await this.startUser(userId);
    }

    logger.info(`Orchestrator started with ${userIds.length} user(s).\n`);

    // Watch for filesystem changes (new users, removed users)
    this.watcher = fs.watch(this.usersDir, (_eventType, filename) => {
      if (filename) {
        this.onUsersDirChange();
      }
    });

    // Periodic state save
    this.stateSaveInterval = setInterval(() => {
      this.saveState().catch((err) => logger.error("Failed to save state:", err));
    }, STATE_SAVE_INTERVAL_MS);

    // Initial state save
    await this.saveState();
  }

  async stop(): Promise<void> {
    logger.info("Stopping orchestrator...");

    if (this.stateSaveInterval) {
      clearInterval(this.stateSaveInterval);
    }
    this.watcher?.close();

    // Stop all monitors
    for (const [userId, session] of this.sessions) {
      logger.info(`Stopping monitor for ${userId}...`);
      session.monitor.stop();
      session.status = "stopped";
    }

    // Wait briefly for monitors to finish
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Close shared browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    await this.saveState();
    logger.info("Orchestrator stopped.");
  }

  listUsers(): string[] {
    return discoverUsers(this.usersDir);
  }

  getUserStates(): UserState[] {
    return Array.from(this.sessions.values()).map((s) => ({
      userId: s.userId,
      status: s.status,
    }));
  }

  async removeUser(userId: string): Promise<void> {
    // Stop monitor if running
    const session = this.sessions.get(userId);
    if (session) {
      session.monitor.stop();
      this.sessions.delete(userId);
    }

    // Remove user data directory
    const userDir = path.join(this.usersDir, userId);
    if (fs.existsSync(userDir)) {
      fs.rmSync(userDir, { recursive: true, force: true });
    }

    await this.saveState();
    logger.info(`User ${userId} removed.`);
  }

  async saveState(): Promise<void> {
    const states: UserState[] = this.getUserStates();
    const tmpPath = this.statePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(states, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.statePath);
  }

  private async startUser(userId: string): Promise<void> {
    if (this.sessions.has(userId)) return;
    if (!this.browser) return;

    try {
      const config = loadUserConfig(this.usersDir, userId);
      const port = this.allocatePort(userId);
      const vncPort = port + 900;

      const monitor = new BaleMonitor(
        config,
        this.browser,
        userId,
        port,
        vncPort,
        this.masterConfig.serverIp,
      );

      const session: UserSession = {
        userId,
        config,
        monitor,
        status: "starting",
      };
      this.sessions.set(userId, session);

      // Start monitor in background (don't await — it runs indefinitely)
      monitor.start().then(() => {
        const s = this.sessions.get(userId);
        if (s) s.status = "stopped";
      }).catch((err) => {
        logger.error(`[${userId}] Monitor crashed:`, err);
        const s = this.sessions.get(userId);
        if (s) s.status = "stopped";
      });

      session.status = "running";
      logger.info(`Started monitor for user ${userId} (noVNC port: ${port})`);
    } catch (err) {
      logger.error(`Failed to start user ${userId}:`, err);
    }
  }

  private allocatePort(userId: string): number {
    const users = discoverUsers(this.usersDir).sort();
    const index = users.indexOf(userId);
    const [start] = this.masterConfig.novncPortRange;
    return start + index;
  }

  private onUsersDirChange(): void {
    const currentUsers = new Set(discoverUsers(this.usersDir));
    const runningUsers = new Set(this.sessions.keys());

    // Start new users
    for (const userId of currentUsers) {
      if (!runningUsers.has(userId)) {
        this.startUser(userId).catch((err) =>
          logger.error(`Failed to auto-start user ${userId}:`, err),
        );
      }
    }

    // Stop removed users
    for (const userId of runningUsers) {
      if (!currentUsers.has(userId)) {
        const session = this.sessions.get(userId);
        if (session) {
          session.monitor.stop();
          this.sessions.delete(userId);
          logger.info(`Auto-stopped removed user ${userId}`);
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.ts tests/orchestrator.test.ts
git commit -m "feat: add multi-tenant orchestrator with filesystem watcher"
```

---

### Task 8: CLI Handler & Main Entry Point

**Files:**
- Create: `src/cli.ts`
- Modify: `src/main.ts`
- Create: `bin/bale`

- [ ] **Step 1: Create `src/cli.ts`**

```typescript
import input from "@inquirer/input";
import fs from "node:fs";
import path from "node:path";
import { discoverUsers, loadUserConfig, loadMasterConfig } from "./config.js";
import { runWizard } from "./setup/wizard.js";
import { logger } from "./logger.js";
import { DEFAULT_USERS_DIR } from "./constants.js";

const DATA_DIR = process.env.DATA_DIR || "/data";
const USERS_DIR = path.join(DATA_DIR, "users");

export async function handleCli(command: string): Promise<void> {
  switch (command) {
    case "add-user":
      await addUser();
      break;
    case "remove-user":
      await removeUser();
      break;
    case "list-users":
      listUsers();
      break;
    case "status":
      showStatus();
      break;
    default:
      logger.error(`Unknown command: ${command}`);
      logger.info("Usage: bale [add-user|remove-user|list-users|status]");
      process.exit(1);
  }
}

async function addUser(): Promise<void> {
  const userId = await input({
    message: "Enter a user ID (alphanumeric, used as directory name):",
    validate: (v) => /^[a-zA-Z0-9_-]+$/.test(v) || "Must be alphanumeric (dashes and underscores allowed)",
  });

  const userDir = path.join(USERS_DIR, userId);
  if (fs.existsSync(path.join(userDir, "config.json"))) {
    logger.error(`User "${userId}" already exists.`);
    process.exit(1);
  }

  const configPath = path.join(userDir, "config.json");
  const sessionDir = path.join(userDir, "session");

  // Run the setup wizard with the user's paths
  await runWizard(configPath, sessionDir);

  logger.info(`\nUser "${userId}" added. The orchestrator will auto-detect and start monitoring.`);
  logger.info("No container restart needed.\n");
}

async function removeUser(): Promise<void> {
  const users = discoverUsers(USERS_DIR);
  if (users.length === 0) {
    logger.info("No users configured.");
    return;
  }

  const userId = await input({
    message: `Enter user ID to remove (${users.join(", ")}):`,
  });

  if (!users.includes(userId)) {
    logger.error(`User "${userId}" not found.`);
    process.exit(1);
  }

  const userDir = path.join(USERS_DIR, userId);
  fs.rmSync(userDir, { recursive: true, force: true });
  logger.info(`User "${userId}" removed. The orchestrator will auto-detect and stop the monitor.`);
}

function listUsers(): void {
  const users = discoverUsers(USERS_DIR);
  if (users.length === 0) {
    logger.info("No users configured.");
    return;
  }

  logger.info("Configured users:");
  for (const userId of users) {
    try {
      const config = loadUserConfig(USERS_DIR, userId);
      logger.info(`  ${userId}: ${config.channel.type} -> ${config.bale.sessionDir}`);
    } catch {
      logger.info(`  ${userId}: (config error)`);
    }
  }
}

function showStatus(): void {
  const statePath = path.join(DATA_DIR, "state.json");
  if (!fs.existsSync(statePath)) {
    logger.info("No state file found. Is the orchestrator running?");
    return;
  }

  try {
    const states = JSON.parse(fs.readFileSync(statePath, "utf-8")) as Array<{ userId: string; status: string }>;
    if (states.length === 0) {
      logger.info("No active sessions.");
      return;
    }
    logger.info("User sessions:");
    for (const s of states) {
      logger.info(`  ${s.userId}: ${s.status}`);
    }
  } catch {
    logger.error("Failed to read state file.");
  }
}
```

- [ ] **Step 2: Create `bin/bale` shell wrapper**

```bash
#!/bin/sh
# Bale Notifier CLI wrapper
# Runs inside the container via: docker compose exec bale-notifier bale <command>

case "$1" in
  add-user|remove-user|list-users|status)
    exec node /app/dist/cli.js "$1"
    ;;
  "")
    exec node /app/dist/main.js
    ;;
  *)
    echo "Usage: bale [add-user|remove-user|list-users|status]"
    echo ""
    echo "Commands:"
    echo "  add-user      Add a new user (interactive setup)"
    echo "  remove-user   Remove a user and their data"
    echo "  list-users    List all configured users"
    echo "  status        Show running session status"
    echo ""
    echo "No command starts the orchestrator."
    exit 1
    ;;
esac
```

- [ ] **Step 3: Refactor `src/main.ts`**

Replace the entire file:

```typescript
import { migrateSingleToMulti } from "./config.js";
import { Orchestrator } from "./orchestrator.js";
import { handleCli } from "./cli.js";
import { logger } from "./logger.js";

const DATA_DIR = process.env.DATA_DIR || "/data";

async function main(): Promise<void> {
  logger.info("Bale Notifier v2.0.0 (multi-tenant)\n");

  // Auto-migrate old single-user config if present
  migrateSingleToMulti(DATA_DIR);

  const orchestrator = new Orchestrator(DATA_DIR);

  const shutdown = () => {
    logger.info("\nShutting down...");
    orchestrator.stop().then(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await orchestrator.start();
}

// If called with a CLI argument, handle as CLI command
const args = process.argv.slice(2);
if (args.length > 0) {
  handleCli(args[0]).catch((err) => {
    logger.error("CLI error:", err);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    logger.error("Fatal error:", err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/main.ts bin/bale
git commit -m "feat: add CLI handler (add-user, remove-user, list-users, status) and refactor main entry point"
```

---

### Task 9: Wizard Multi-User Support

**Files:**
- Modify: `src/setup/wizard.ts`

Fix the `sessionDirFromConfigPath` bug and accept an explicit `sessionDir` parameter so the wizard works with multi-user paths.

- [ ] **Step 1: Update `src/setup/wizard.ts`**

Change the `runWizard` function signature to accept an optional `sessionDir` parameter:

```typescript
export async function runWizard(configPath = DEFAULT_CONFIG_PATH, explicitSessionDir?: string): Promise<AppConfig> {
  logger.info("Welcome to Bale Notifier!\n");

  const sessionDir = explicitSessionDir || sessionDirFromConfigPath(configPath);
  const channelConfig = await setupChannel();
  const notifications = await setupNotificationPrefs();
  const noVncUrl = await setupNoVncUrl();

  const config: AppConfig = {
    bale: { sessionDir, noVncUrl },
    channel: channelConfig,
    notifications,
  };

  saveConfig(configPath, config);
  logger.info(`\nConfig saved to ${configPath}`);
  logger.info("Setup complete.\n");

  return config;
}
```

Also update `setupBaleAuth` to accept the session dir explicitly. Change the signature and remove the local `sessionDirFromConfigPath(DEFAULT_CONFIG_PATH)` call:

```typescript
async function setupBaleAuth(sessionDir: string): Promise<string> {
  logger.info("Step 1: Authenticate with Bale\n");

  const headless = isHeadless();

  if (headless) {
    logger.info("Detected headless environment. Starting noVNC...\n");
    const url = await startNoVnc();
    logger.info(`Open this URL in your browser to log into Bale:\n  ${url}\n`);
    process.env.DISPLAY = ":99";
  }

  // Clean up stale Chromium lock files from previous runs
  const lockFile = `${sessionDir}/SingletonLock`;
  try { fs.unlinkSync(lockFile); } catch (err) { logger.debug("No stale lock file to clean:", err); }

  // ... rest stays the same until the end ...
```

And update the `runWizard` call to pass sessionDir to `setupBaleAuth`:

```typescript
  const sessionDir = explicitSessionDir || sessionDirFromConfigPath(configPath);
  await setupBaleAuth(sessionDir);
```

- [ ] **Step 2: Run build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/setup/wizard.ts
git commit -m "fix: wizard accepts explicit sessionDir, fix sessionDirFromConfigPath bug for multi-user paths"
```

---

### Task 10: Docker Updates

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Update `Dockerfile`**

Replace the entire file:

```dockerfile
FROM node:20-alpine

RUN apk add --no-cache \
    chromium \
    xvfb \
    x11vnc \
    python3 \
    py3-pip \
    && pip3 install --break-system-packages websockify \
    && mkdir -p /usr/share/novnc \
    && wget -qO- https://github.com/novnc/noVNC/archive/refs/tags/v1.4.0.tar.gz | tar xz --strip-components=1 -C /usr/share/novnc

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

RUN npm prune --omit=dev

# Install bale CLI wrapper
COPY bin/bale /usr/local/bin/bale
RUN chmod +x /usr/local/bin/bale

EXPOSE 6081-6090

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD pgrep -f "node dist/main.js" > /dev/null || exit 1

ENTRYPOINT ["node", "dist/main.js"]
```

- [ ] **Step 2: Update `docker-compose.yml`**

Replace the entire file:

```yaml
services:
  bale-notifier:
    build: .
    container_name: bale-notifier
    stdin_open: true
    tty: true
    restart: unless-stopped
    ports:
      - "6081-6090:6081-6090"
    volumes:
      - ./data:/data
    environment:
      - DISPLAY=:99
      - DATA_DIR=/data
    deploy:
      resources:
        limits:
          memory: 2G
    healthcheck:
      test: ["CMD", "pgrep", "-f", "node dist/main.js"]
      interval: 30s
      timeout: 5s
      start_period: 10s
      retries: 3
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat: update Docker for single-container multi-tenant with port range and bale CLI wrapper"
```

---

### Task 11: Run Full Test Suite & Build

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (existing + new)

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Clean build, no errors

- [ ] **Step 3: Fix any failing tests or build errors**

Address any issues found in steps 1-2.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve test and build issues from multi-tenant refactor"
```

---

### Task 12: Update Existing Tests

**Files:**
- Modify: `tests/config.test.ts` — Fix `AppConfig` shape (add `noVncUrl` field)

The existing config test creates `AppConfig` objects without `noVncUrl`. Since `noVncUrl` is still required in the interface (for backward compatibility), verify the existing tests still pass. If any fail due to the interface change, add the missing field.

- [ ] **Step 1: Run existing tests**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (no changes needed — `noVncUrl` was already in the interface)

- [ ] **Step 2: If any tests fail, fix them**

Check the error output and add `noVncUrl` to any test configs that are missing it.

- [ ] **Step 3: Commit fixes if needed**

```bash
git add tests/
git commit -m "fix: update existing tests for multi-tenant compatibility"
```

---

## Self-Review Checklist

After completing all tasks:

1. **Spec coverage**: Verify each section of `docs/superpowers/specs/2026-05-11-single-browser-multi-tenant-design.md` maps to a task:
   - Architecture → Tasks 5, 6, 7
   - User Lifecycle → Tasks 7, 8
   - Configuration & Storage → Tasks 1, 2
   - Error Handling & Isolation → Task 6 (monitor), Task 7 (orchestrator)
   - Login Isolation (noVNC) → Task 4
   - Notification Channel Isolation → Task 6 (per-user channel instance)
   - Docker & Deployment → Task 10
   - Testing → Tasks 2, 3, 4, 7

2. **Placeholder scan**: Search for TBD, TODO, "implement later", "fill in details" — none present.

3. **Type consistency**: `MasterConfig` and `UserState` defined in Task 1 are used consistently in Tasks 2, 7, 8. `BaleMonitor` constructor in Task 6 matches the usage in Task 7's orchestrator. `NoVncSession` constructor in Task 4 matches usage in Task 6.

4. **Import paths**: All use `.js` extension as required by `moduleResolution: Node16`.
