# Robustness Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 12 issues that prevent notifications from being sent and make the multi-tenant system fragile.

**Architecture:** Persist cookies + localStorage per user alongside the shared browser context. Restructure wizard to ask server IP first and save to master.json. Make port allocation persistent. Add decoder logging, re-login loop protection, channel validation, and FSWatcher debounce.

**Tech Stack:** TypeScript, Puppeteer, Vitest, Node.js fs/path

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/storage.ts` | **NEW** — save/load localStorage entries per session |
| `src/types.ts` | Remove `noVncUrl` from `AppConfig.bale`, add `userPorts` to `MasterConfig` |
| `src/config.ts` | Add `ensureMasterConfig()` for CLI use, update `loadMasterConfig` defaults |
| `src/engine/browser.ts` | Call `loadLocalStorage`/`saveLocalStorage` in `createUserContext` |
| `src/engine/monitor.ts` | Decoder logging, re-login loop protection, Xvfb safety, shared browser reuse |
| `src/setup/novnc.ts` | Expose Xvfb running status |
| `src/setup/wizard.ts` | Remove Step 4, accept serverIp param, add channel validation, session save check |
| `src/cli.ts` | Init master.json before wizard, pass serverIp to wizard |
| `src/orchestrator.ts` | Persistent port allocation, FSWatcher debounce |
| `docker-compose.yml` | Remove dead port 6080 |
| `tests/storage.test.ts` | **NEW** — tests for localStorage persistence |
| `tests/config-multi.test.ts` | Update for new MasterConfig shape (userPorts) |
| `tests/orchestrator.test.ts` | Update for new port allocation + FSWatcher debounce |

---

### Task 1: Add localStorage persistence module

**Files:**
- Create: `src/storage.ts`
- Create: `tests/storage.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/storage.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { saveLocalStorage, loadLocalStorage } from "../src/storage.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bale-storage-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("saveLocalStorage and loadLocalStorage", () => {
  it("round-trips localStorage entries to disk", async () => {
    const entries = [
      { key: "authToken", value: "abc123" },
      { key: "userId", value: "42" },
    ];
    await saveLocalStorage(entries, tmpDir);
    const loaded = await loadLocalStorage(tmpDir);
    expect(loaded).toEqual(entries);
  });

  it("creates the directory if it does not exist", async () => {
    const storageDir = path.join(tmpDir, "sub", "dir");
    const entries = [{ key: "k", value: "v" }];
    await saveLocalStorage(entries, storageDir);
    const loaded = await loadLocalStorage(storageDir);
    expect(loaded).toEqual(entries);
  });

  it("returns empty array when no file exists", async () => {
    const loaded = await loadLocalStorage(tmpDir);
    expect(loaded).toEqual([]);
  });

  it("overwrites existing data on save", async () => {
    await saveLocalStorage([{ key: "old", value: "data" }], tmpDir);
    await saveLocalStorage([{ key: "new", value: "stuff" }], tmpDir);
    const loaded = await loadLocalStorage(tmpDir);
    expect(loaded).toEqual([{ key: "new", value: "stuff" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/storage.ts
import fs from "node:fs";
import path from "node:path";

export interface LocalStorageEntry {
  key: string;
  value: string;
}

const STORAGE_FILE = "local-storage.json";

export async function saveLocalStorage(
  entries: LocalStorageEntry[],
  dir: string,
): Promise<void> {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, STORAGE_FILE);
  const data = JSON.stringify({ entries }, null, 2);
  fs.writeFileSync(filePath, data, "utf-8");
}

export async function loadLocalStorage(
  dir: string,
): Promise<LocalStorageEntry[]> {
  const filePath = path.join(dir, STORAGE_FILE);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as { entries: LocalStorageEntry[] };
  return parsed.entries ?? [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/storage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage.ts tests/storage.test.ts
git commit -m "feat: add localStorage persistence module for session state"
```

---

### Task 2: Update types — remove noVncUrl, add userPorts

**Files:**
- Modify: `src/types.ts:44-48` (AppConfig.bale)
- Modify: `src/types.ts:72-77` (MasterConfig)

- [ ] **Step 1: Update types**

In `src/types.ts`, change `AppConfig.bale` from:

```typescript
export interface AppConfig {
  bale: {
    sessionDir: string;
    noVncUrl: string;
  };
```

to:

```typescript
export interface AppConfig {
  bale: {
    sessionDir: string;
  };
```

Change `MasterConfig` from:

```typescript
export interface MasterConfig {
  serverIp: string;
  novncPortRange: [number, number];
  loginTimeoutMinutes: number;
  logLevel?: string;
}
```

to:

```typescript
export interface MasterConfig {
  serverIp: string;
  novncPortRange: [number, number];
  loginTimeoutMinutes: number;
  userPorts: Record<string, number>;
  logLevel?: string;
}
```

- [ ] **Step 2: Update config.ts loadMasterConfig default**

In `src/config.ts`, change the default in `loadMasterConfig()` from:

```typescript
export function loadMasterConfig(configPath: string): MasterConfig {
  if (!fs.existsSync(configPath)) {
    return {
      serverIp: "localhost",
      novncPortRange: DEFAULT_NOVNC_PORT_RANGE,
      loginTimeoutMinutes: DEFAULT_LOGIN_TIMEOUT_MINUTES,
    };
  }
```

to:

```typescript
export function loadMasterConfig(configPath: string): MasterConfig {
  if (!fs.existsSync(configPath)) {
    return {
      serverIp: "localhost",
      novncPortRange: DEFAULT_NOVNC_PORT_RANGE,
      loginTimeoutMinutes: DEFAULT_LOGIN_TIMEOUT_MINUTES,
      userPorts: {},
    };
  }
```

Also add `userPorts` coalesce for existing master.json files that lack it. After loading:

```typescript
  const raw = fs.readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as MasterConfig;
  config.userPorts = config.userPorts ?? {};
  return config;
```

- [ ] **Step 3: Add ensureMasterConfig to config.ts**

Add this function at the end of `src/config.ts`:

```typescript
export function ensureMasterConfig(configPath: string): MasterConfig {
  if (fs.existsSync(configPath)) {
    return loadMasterConfig(configPath);
  }
  const config: MasterConfig = {
    serverIp: "localhost",
    novncPortRange: DEFAULT_NOVNC_PORT_RANGE,
    loginTimeoutMinutes: DEFAULT_LOGIN_TIMEOUT_MINUTES,
    userPorts: {},
  };
  saveMasterConfig(configPath, config);
  return config;
}
```

- [ ] **Step 4: Update tests that reference noVncUrl**

In `tests/config-multi.test.ts`, change the `loadUserConfig` test from:

```typescript
    const config: AppConfig = {
      bale: { sessionDir: "/data/users/alice/session", noVncUrl: "" },
```

to:

```typescript
    const config: AppConfig = {
      bale: { sessionDir: "/data/users/alice/session" },
```

In `tests/orchestrator.test.ts`, change `writeUserConfig` from:

```typescript
      bale: { sessionDir: path.join(dir, "session"), noVncUrl: "" },
```

to:

```typescript
      bale: { sessionDir: path.join(dir, "session") },
```

- [ ] **Step 5: Run all tests to verify nothing breaks**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/config.ts tests/config-multi.test.ts tests/orchestrator.test.ts
git commit -m "refactor: remove noVncUrl from AppConfig, add userPorts to MasterConfig"
```

---

### Task 3: Integrate localStorage into browser context lifecycle

**Files:**
- Modify: `src/engine/browser.ts:62-88` (createUserContext)
- Modify: `src/engine/monitor.ts:68-154` (runSession)

- [ ] **Step 1: Update createUserContext in browser.ts**

Add imports at top of `src/engine/browser.ts`:

```typescript
import { saveLocalStorage, loadLocalStorage } from "../storage.js";
```

Change the `createUserContext` function to save/load localStorage. The full replacement:

```typescript
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
    await page.setCookie(...(cookies as any));
  }

  // Restore saved localStorage
  const lsEntries = await loadLocalStorage(sessionDir);
  if (lsEntries.length > 0) {
    await page.evaluateOnNewDocument((entries: { key: string; value: string }[]) => {
      for (const { key, value } of entries) {
        try { localStorage.setItem(key, value); } catch {}
      }
    }, lsEntries);
  }

  const close = async () => {
    // Save cookies before closing
    try {
      const currentCookies = await page.cookies();
      await saveCookies(currentCookies as any, sessionDir);
    } catch {
      // Page may already be closed
    }
    // Save localStorage before closing
    try {
      const entries = await page.evaluate(() => {
        const items: { key: string; value: string }[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) items.push({ key, value: localStorage.getItem(key) ?? "" });
        }
        return items;
      });
      await saveLocalStorage(entries, sessionDir);
    } catch {
      // Page may already be closed
    }
    await context.close();
  };

  return { context, page, close };
}
```

- [ ] **Step 2: Save localStorage after re-login in monitor.ts**

In `src/engine/monitor.ts`, add the import:

```typescript
import { saveLocalStorage } from "../storage.js";
```

In `handleRelogin()`, after the line `await saveCookies(cookies, this.config.bale.sessionDir);` (around line 216), add:

```typescript
      // Save localStorage from re-login browser
      try {
        const lsEntries = await page.evaluate(() => {
          const items: { key: string; value: string }[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) items.push({ key, value: localStorage.getItem(key) ?? "" });
          }
          return items;
        });
        await saveLocalStorage(lsEntries, this.config.bale.sessionDir);
      } catch (err) {
        logger.debug(`[${this.userId}] Could not save localStorage after re-login:`, err);
      }
```

- [ ] **Step 3: Run tests to verify**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/engine/browser.ts src/engine/monitor.ts
git commit -m "feat: persist and restore localStorage alongside cookies in browser contexts"
```

---

### Task 4: Restructure wizard flow — server IP first

**Files:**
- Modify: `src/cli.ts:32-51` (addUser)
- Modify: `src/setup/wizard.ts` (remove Step 4, accept serverIp, add validation)

- [ ] **Step 1: Update cli.ts to init master.json before wizard**

Replace the `addUser` function in `src/cli.ts` with:

```typescript
import input from "@inquirer/input";
import confirm from "@inquirer/confirm";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { discoverUsers, loadUserConfig, ensureMasterConfig, saveMasterConfig } from "./config.js";
import { runWizard } from "./setup/wizard.js";
import { logger } from "./logger.js";

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
  // Ensure master config exists and has a valid server IP
  const masterConfigPath = path.join(DATA_DIR, "master.json");
  const masterConfig = ensureMasterConfig(masterConfigPath);

  if (masterConfig.serverIp === "localhost") {
    const detectedIp = detectServerIp();
    const defaultIp = detectedIp || "localhost";
    const ip = await input({ message: "Server IP or hostname (for noVNC re-login links):", default: defaultIp });
    masterConfig.serverIp = ip;
    saveMasterConfig(masterConfigPath, masterConfig);
    logger.info(`Server IP set to ${ip}\n`);
  } else {
    const keep = await confirm({ message: `Server IP is ${masterConfig.serverIp}. Keep it?`, default: true });
    if (!keep) {
      const ip = await input({ message: "New server IP or hostname:", default: masterConfig.serverIp });
      masterConfig.serverIp = ip;
      saveMasterConfig(masterConfigPath, masterConfig);
      logger.info(`Server IP updated to ${ip}\n`);
    }
  }

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

  await runWizard(configPath, sessionDir, masterConfig.serverIp);

  logger.info(`\nUser "${userId}" added. The orchestrator will auto-detect and start monitoring.`);
  logger.info("No container restart needed.\n");
}

function detectServerIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    if (name === "lo" || name.startsWith("docker") || name.startsWith("br-")) continue;
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
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

- [ ] **Step 2: Update wizard.ts — accept serverIp, remove Step 4, add validation**

Replace the entire `src/setup/wizard.ts` with:

```typescript
import input from "@inquirer/input";
import select from "@inquirer/select";
import confirm from "@inquirer/confirm";
import puppeteer from "puppeteer";
import fs from "node:fs";
import type { AppConfig, ChannelType } from "../types.js";
import { saveConfig } from "../config.js";
import { createChannel } from "../channels/index.js";
import { startNoVnc, stopNoVnc } from "./novnc.js";
import { logger } from "../logger.js";
import { BALE_URL, DEFAULT_CONFIG_PATH, BROWSER_LAUNCH_ARGS, NAVIGATION_TIMEOUT_MS, SPA_RENDER_TIMEOUT_MS, CONTENT_RENDER_TIMEOUT_MS, LOGIN_TIMEOUT_MS, NOVNC_PORT } from "../constants.js";

function sessionDirFromConfigPath(configPath: string): string {
  const dataDir = configPath.substring(0, configPath.lastIndexOf("/"));
  return `${dataDir}/bale-session`;
}

function isHeadless(): boolean {
  return !process.env.DISPLAY || process.env.DISPLAY === ":99" || process.env.DISPLAY === "";
}

export async function runWizard(
  configPath = DEFAULT_CONFIG_PATH,
  explicitSessionDir?: string,
  serverIp?: string,
): Promise<AppConfig> {
  logger.info("Welcome to Bale Notifier!\n");

  const sessionDir = explicitSessionDir || sessionDirFromConfigPath(configPath);
  await setupBaleAuth(sessionDir, serverIp);
  const channelConfig = await setupChannel();
  const notifications = await setupNotificationPrefs();

  const config: AppConfig = {
    bale: { sessionDir },
    channel: channelConfig,
    notifications,
  };

  saveConfig(configPath, config);
  logger.info(`\nConfig saved to ${configPath}`);

  // Validate that session was saved
  validateSessionDir(sessionDir);

  logger.info("Setup complete. Monitoring Bale for notifications.\n");

  return config;
}

async function setupBaleAuth(sessionDir: string, serverIp?: string): Promise<void> {
  logger.info("Step 1: Authenticate with Bale\n");

  const headless = isHeadless();

  if (headless) {
    logger.info("Detected headless environment. Starting noVNC...\n");
    const url = await startNoVnc();
    const displayUrl = serverIp ? url.replace("localhost", serverIp) : url;
    logger.info("");
    logger.info("========================================");
    logger.info("  Open this URL in your browser to log into Bale:");
    logger.info(`  ${displayUrl}`);
    logger.info("========================================");
    logger.info("");
    process.env.DISPLAY = ":99";
  }

  // Clean up stale Chromium lock files from previous runs
  const lockFile = `${sessionDir}/SingletonLock`;
  try { fs.unlinkSync(lockFile); } catch (err) { logger.debug("No stale lock file to clean:", err); }

  logger.info("Opening browser for Bale login...\n");

  const browser = await puppeteer.launch({
    headless: false,
    args: BROWSER_LAUNCH_ARGS,
    userDataDir: sessionDir,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ":99" },
  });

  const page = await browser.newPage();
  await page.goto(BALE_URL, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });

  // Wait for the React SPA to fully render
  try {
    await page.waitForFunction(
      `!document.querySelector('.splash-container') && !document.querySelector('.spin')`,
      { timeout: SPA_RENDER_TIMEOUT_MS }
    );
  } catch (err) { logger.warn("Timeout waiting for SPA render, continuing...", err); }

  try {
    await page.waitForFunction(
      `document.querySelectorAll('span, button, input').length > 5`,
      { timeout: CONTENT_RENDER_TIMEOUT_MS }
    );
  } catch (err) { logger.warn("Timeout waiting for content render, continuing...", err); }

  // Check if logged in by looking for login-specific content
  const pageText = await page.evaluate("document.body.textContent || ''") as string;
  const url = page.url();
  const needsLogin = url.includes("/login") ||
    pageText.includes("Choosing the option to log in") ||
    pageText.includes("login me") ||
    pageText.includes("زبان");

  if (!needsLogin) {
    logger.info("Already logged in from a previous session.\n");
  } else {
    if (headless) {
      logger.info("Please log into Bale using the VNC browser (the URL above).");
    } else {
      logger.info("Please log into Bale in the browser window that opened.");
    }

    logger.info("Waiting for login to complete...\n");

    try {
      await page.waitForFunction(
        `!window.location.pathname.includes('/login') && !document.body.textContent.includes('login me') && !document.body.textContent.includes('زبان')`,
        { timeout: LOGIN_TIMEOUT_MS }
      );
      logger.info("Login detected!\n");
    } catch {
      logger.warn("Login timeout — if you've completed login, the session will still be saved.\n");
    }
  }

  await browser.close();

  if (headless) {
    stopNoVnc();
  }

  logger.info("Bale session captured.\n");
}

async function setupChannel(): Promise<AppConfig["channel"]> {
  logger.info("Step 2: Choose where to receive notifications\n");

  // Loop until validation passes or user gives up
  while (true) {
    const channelType = await select({
      message: "Where do you want to receive notifications?",
      choices: [
        { value: "telegram" as ChannelType, name: "Telegram" },
        { value: "discord" as ChannelType, name: "Discord" },
        { value: "slack" as ChannelType, name: "Slack" },
      ],
    });

    let channelConfig: AppConfig["channel"];

    switch (channelType) {
      case "telegram": {
        logger.info("\nTo set up Telegram notifications:");
        logger.info("  1. Open Telegram and search for @BotFather");
        logger.info("  2. Send /newbot and follow the prompts to create a bot");
        logger.info("  3. Copy the bot token BotFather gives you\n");
        const botToken = await input({ message: "Enter your Telegram bot token:" });
        logger.info("\nTo get your chat ID:");
        logger.info("  1. Open Telegram and send any message to your new bot");
        logger.info("  2. Open this URL in your browser:");
        logger.info(`     https://api.telegram.org/bot${botToken}/getUpdates`);
        logger.info("  3. Find \"chat\":{\"id\": NUMBER} in the response");
        logger.info("     (if result is empty, send another message to the bot and open the URL in a new browser window)\n");
        const chatId = Number(await input({ message: "Enter your Telegram chat ID:" }));
        channelConfig = { type: "telegram", telegram: { botToken, chatId } };
        break;
      }
      case "discord": {
        logger.info("\nTo set up Discord notifications:");
        logger.info("  1. Open your Discord server settings > Integrations > Webhooks");
        logger.info("  2. Create a new webhook for the channel where you want notifications");
        logger.info("  3. Copy the webhook URL\n");
        const webhookUrl = await input({ message: "Enter your Discord webhook URL:" });
        channelConfig = { type: "discord", discord: { webhookUrl } };
        break;
      }
      case "slack": {
        logger.info("\nTo set up Slack notifications:");
        logger.info("  1. Go to https://api.slack.com/apps and create a new app");
        logger.info("  2. Enable Incoming Webhooks and create one for your channel");
        logger.info("  3. Copy the webhook URL\n");
        const webhookUrl = await input({ message: "Enter your Slack webhook URL:" });
        channelConfig = { type: "slack", slack: { webhookUrl } };
        break;
      }
    }

    // Validate the channel config
    const tempConfig = { bale: { sessionDir: "" }, channel: channelConfig, notifications: { messages: true, calls: true, groups: true } } as AppConfig;
    try {
      const channel = createChannel(tempConfig);
      const valid = await channel.validateConfig();
      if (valid) {
        logger.info("Channel validated successfully!\n");
        return channelConfig;
      }
      logger.warn("Channel validation failed. Please check your credentials.\n");
    } catch (err) {
      logger.warn(`Channel validation error: ${err}. Please try again.\n`);
    }

    const retry = await confirm({ message: "Re-enter channel credentials?", default: true });
    if (!retry) {
      logger.warn("Proceeding without validation. Notifications may fail.\n");
      return channelConfig;
    }
  }
}

async function setupNotificationPrefs(): Promise<AppConfig["notifications"]> {
  logger.info("\nStep 3: Notification preferences\n");

  const messages = await confirm({ message: "Notify on new messages?", default: true });
  const calls = await confirm({ message: "Notify on incoming calls?", default: true });
  const groups = await confirm({ message: "Notify on group activity?", default: true });

  return { messages, calls, groups };
}

function validateSessionDir(sessionDir: string): void {
  if (!fs.existsSync(sessionDir)) {
    logger.warn("Warning: Session directory does not exist. Login may not have been saved.\n");
    return;
  }
  const files = fs.readdirSync(sessionDir);
  if (files.length === 0) {
    logger.warn("Warning: Session directory is empty. Login may not have been saved.\n");
  }
}
```

- [ ] **Step 3: Run tests to verify**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts src/setup/wizard.ts
git commit -m "feat: ask server IP before user setup, validate channel credentials in wizard"
```

---

### Task 5: Persistent port allocation in orchestrator

**Files:**
- Modify: `src/orchestrator.ts:177-182` (allocatePort)
- Modify: `src/orchestrator.ts:135-175` (startUser — save masterConfig after port alloc)
- Modify: `tests/orchestrator.test.ts` — add port allocation tests

- [ ] **Step 1: Write the failing test**

Add to `tests/orchestrator.test.ts`:

```typescript
  it("allocates persistent ports via master config", async () => {
    writeUserConfig("alice");
    writeUserConfig("bob");
    const { Orchestrator } = await import("../src/orchestrator.js");
    const orch = new Orchestrator(tmpDir);
    // Force port allocation via the internal method
    const port1 = (orch as any).allocatePort("alice");
    const port2 = (orch as any).allocatePort("bob");
    expect(port1).toBe(6081);
    expect(port2).toBe(6082);

    // Removing alice should not shift bob's port
    const port2Again = (orch as any).allocatePort("bob");
    expect(port2Again).toBe(6082);

    // Same port on repeat calls
    const port1Again = (orch as any).allocatePort("alice");
    expect(port1Again).toBe(6081);
  });

  it("persists userPorts in master.json", async () => {
    writeUserConfig("alice");
    const { Orchestrator } = await import("../src/orchestrator.js");
    const orch = new Orchestrator(tmpDir);
    (orch as any).allocatePort("alice");

    const masterPath = path.join(tmpDir, "master.json");
    const saved = JSON.parse(fs.readFileSync(masterPath, "utf-8"));
    expect(saved.userPorts.alice).toBe(6081);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: FAIL — allocatePort still uses sorted index

- [ ] **Step 3: Implement persistent port allocation**

Replace `allocatePort` in `src/orchestrator.ts`:

```typescript
  private allocatePort(userId: string): number {
    // If user already has a port, return it
    if (this.masterConfig.userPorts[userId] !== undefined) {
      return this.masterConfig.userPorts[userId];
    }

    // Find next available port in range
    const [start, end] = this.masterConfig.novncPortRange;
    const usedPorts = new Set(Object.values(this.masterConfig.userPorts));
    for (let port = start; port <= end; port++) {
      if (!usedPorts.has(port)) {
        this.masterConfig.userPorts[userId] = port;
        saveMasterConfig(this.masterConfigPath, this.masterConfig);
        return port;
      }
    }

    throw new Error(`No available ports in range ${start}-${end}`);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.ts tests/orchestrator.test.ts
git commit -m "feat: persistent port allocation stored in master.json"
```

---

### Task 6: Decoder logging for null results

**Files:**
- Modify: `src/engine/monitor.ts:78-83` (__baleOnFrame callback)

- [ ] **Step 1: Add logging when decoder returns null**

In `src/engine/monitor.ts`, change the `__baleOnFrame` callback from:

```typescript
      await session.page.exposeFunction("__baleOnFrame", (rawBytes: number[]) => {
        const bytes = new Uint8Array(rawBytes);
        const decoded = decoder.decode(bytes);
        if (decoded && this.config.notifications.messages) {
          this.handleDecodedMessage(session.page, decoded);
        }
      });
```

to:

```typescript
      await session.page.exposeFunction("__baleOnFrame", (rawBytes: number[]) => {
        const bytes = new Uint8Array(rawBytes);
        const decoded = decoder.decode(bytes);
        if (decoded) {
          if (this.config.notifications.messages) {
            this.handleDecodedMessage(session.page, decoded);
          }
        } else {
          const hex = Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, "0")).join(" ");
          logger.debug(`[${this.userId}] WS frame not decoded (${bytes.length} bytes, first 8: ${hex})`);
        }
      });
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/engine/monitor.ts
git commit -m "fix: log undecoded WS frames for debugging"
```

---

### Task 7: Re-login loop protection

**Files:**
- Modify: `src/engine/monitor.ts`

- [ ] **Step 1: Add reloginAttempts counter and cooldown**

Add to the `BaleMonitor` class, after the `backoffMs` field:

```typescript
  private reloginAttempts = 0;
  private static readonly MAX_RELOGIN_ATTEMPTS = 3;
  private static readonly RELOGIN_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
```

Add `RELOGIN_COOLDOWN_MS` to `src/constants.ts`:

```typescript
export const RELOGIN_COOLDOWN_MS = 30 * 60 * 1000;
```

And import it in monitor.ts.

- [ ] **Step 2: Add cooldown logic to runSession**

In `runSession()`, after the `isLoginPage` check that calls `handleRelogin()`, add cooldown:

Change from:

```typescript
      if (isLoginPage) {
        await session.close();
        this.contextClose = null;
        await this.handleRelogin();
        return;
      }
```

to:

```typescript
      if (isLoginPage) {
        await session.close();
        this.contextClose = null;

        this.reloginAttempts++;
        if (this.reloginAttempts > BaleMonitor.MAX_RELOGIN_ATTEMPTS) {
          logger.warn(`[${this.userId}] Max re-login attempts (${BaleMonitor.MAX_RELOGIN_ATTEMPTS}) reached. Cooldown for 30 minutes.`);
          try {
            await this.dispatch({
              type: "relogin",
              timestamp: new Date(),
              source: "Bale Notifier",
              preview: "Session expired. Manual re-login required. Monitoring paused for 30 minutes.",
            });
          } catch (err) {
            logger.debug(`[${this.userId}] Failed to send cooldown notification:`, err);
          }
          await this.sleep(BaleMonitor.RELOGIN_COOLDOWN_MS);
          this.reloginAttempts = 0;
          return;
        }

        await this.handleRelogin();
        return;
      }
```

- [ ] **Step 3: Reset counter on successful session**

In `runSession()`, right after the line `this.backoffMs = RECONNECT_INITIAL_BACKOFF_MS;` (the successful connection point), add:

```typescript
      this.reloginAttempts = 0;
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/monitor.ts src/constants.ts
git commit -m "feat: add re-login loop protection with max attempts and cooldown"
```

---

### Task 8: Xvfb safety and shared browser in re-login

**Files:**
- Modify: `src/setup/novnc.ts` — expose Xvfb running status
- Modify: `src/engine/monitor.ts` — safe re-login with Xvfb check + shared browser

- [ ] **Step 1: Expose Xvfb status in novnc.ts**

Add to `src/setup/novnc.ts`, after the `xvfbStarted` variable:

```typescript
export function isXvfbRunning(): boolean {
  return xvfbStarted && sharedXvfb !== null && !sharedXvfb.killed;
}
```

- [ ] **Step 2: Rewrite handleRelogin to use shared browser when possible**

Replace the entire `handleRelogin` method in `src/engine/monitor.ts`. First add the import:

```typescript
import { isXvfbRunning } from "../setup/novnc.js";
```

Then replace `handleRelogin`:

```typescript
  private async handleRelogin(): Promise<void> {
    logger.warn(`[${this.userId}] Bale session expired. Starting re-login flow...\n`);

    const headless = !process.env.DISPLAY || process.env.DISPLAY === ":99" || process.env.DISPLAY === "";
    const xvfbAvailable = isXvfbRunning();

    let novncUrl = "";
    let novnc: NoVncSession | null = null;
    let usedSharedBrowser = false;
    let reloginPage: Page;
    let reloginClose: (() => Promise<void>) | null = null;

    if (headless && xvfbAvailable) {
      // Full noVNC flow: user can interact via browser
      try {
        novnc = new NoVncSession(this.novncPort, this.vncPort);
        novncUrl = await novnc.start();
        logger.info(`[${this.userId}] noVNC started: ${novncUrl}`);
      } catch (err) {
        logger.warn(`[${this.userId}] Failed to start noVNC:`, err);
      }
    }

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

    if (novnc) {
      // noVNC is active — launch a separate browser so user can interact with display
      const display = novnc.display;
      const { browser, page } = await launchReloginBrowser(display, this.config.bale.sessionDir);
      reloginPage = page;
      reloginClose = () => browser.close();
    } else if (this.sharedBrowser) {
      // No noVNC — use shared browser context (headless, user can't interact)
      logger.warn(`[${this.userId}] No noVNC available. Attempting headless re-login...`);
      const session = await createUserContext(this.sharedBrowser, this.config.bale.sessionDir);
      reloginPage = session.page;
      reloginClose = session.close;
      usedSharedBrowser = true;
    } else {
      logger.error(`[${this.userId}] No browser available for re-login. Skipping.`);
      return;
    }

    try {
      if (!usedSharedBrowser) {
        // Full browser — navigate to Bale
        await reloginPage.goto(BALE_URL, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });

        try {
          await reloginPage.waitForFunction(
            `!document.querySelector('.splash-container') && !document.querySelector('.spin')`,
            { timeout: SPA_RENDER_TIMEOUT_MS },
          );
        } catch { /* ignore render timeout */ }

        try {
          await reloginPage.waitForFunction(
            `document.querySelectorAll('span, button, input').length > 5`,
            { timeout: CONTENT_RENDER_TIMEOUT_MS },
          );
        } catch { /* ignore content timeout */ }
      }

      logger.info(`[${this.userId}] Waiting for re-login...`);
      await reloginPage.waitForFunction(
        `!window.location.pathname.includes('/login') && !document.body.textContent.includes('login me') && !document.body.textContent.includes('زبان')`,
        { timeout: RELOGIN_TIMEOUT_MS },
      );
      logger.info(`[${this.userId}] Re-login successful! Resuming monitoring...\n`);

      // Save cookies + localStorage
      const cookies = await reloginPage.cookies() as any;
      await saveCookies(cookies, this.config.bale.sessionDir);

      try {
        const lsEntries = await reloginPage.evaluate(() => {
          const items: { key: string; value: string }[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) items.push({ key, value: localStorage.getItem(key) ?? "" });
          }
          return items;
        });
        await saveLocalStorage(lsEntries, this.config.bale.sessionDir);
      } catch (err) {
        logger.debug(`[${this.userId}] Could not save localStorage after re-login:`, err);
      }
    } finally {
      await reloginClose?.();
      novnc?.stop();
    }
  }
```

Add imports at top of monitor.ts (if not already present from Task 3):

```typescript
import { isXvfbRunning } from "../setup/novnc.js";
```

`saveLocalStorage` and `createUserContext` were already imported in Task 3 and the existing code respectively.

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/setup/novnc.ts src/engine/monitor.ts
git commit -m "fix: safe re-login with Xvfb check and shared browser fallback"
```

---

### Task 9: FSWatcher debounce in orchestrator

**Files:**
- Modify: `src/orchestrator.ts:65-67` (watcher setup), `src/orchestrator.ts:184-206` (onUsersDirChange)

- [ ] **Step 1: Add debounce timer field and debounced handler**

Add a field to the `Orchestrator` class:

```typescript
  private watcherTimer: NodeJS.Timeout | null = null;
```

Replace the watcher setup in `start()` from:

```typescript
    this.watcher = fs.watch(this.usersDir, () => {
      this.onUsersDirChange();
    });
```

to:

```typescript
    this.watcher = fs.watch(this.usersDir, () => {
      if (this.watcherTimer) clearTimeout(this.watcherTimer);
      this.watcherTimer = setTimeout(() => {
        this.watcherTimer = null;
        this.onUsersDirChange();
      }, 2000);
    });
```

In `stop()`, add cleanup before `this.watcher?.close()`:

```typescript
    if (this.watcherTimer) {
      clearTimeout(this.watcherTimer);
      this.watcherTimer = null;
    }
```

- [ ] **Step 2: Add config validation in onUsersDirChange**

Replace `onUsersDirChange` with:

```typescript
  private onUsersDirChange(): void {
    const currentUsers = new Set(discoverUsers(this.usersDir));
    const runningUsers = new Set(this.sessions.keys());

    for (const userId of currentUsers) {
      if (!runningUsers.has(userId)) {
        // Validate config before starting
        const configPath = path.join(this.usersDir, userId, "config.json");
        try {
          const raw = fs.readFileSync(configPath, "utf-8");
          JSON.parse(raw);
        } catch {
          logger.warn(`User directory "${userId}" has no valid config.json, skipping`);
          continue;
        }
        this.startUser(userId).catch((err) =>
          logger.error(`Failed to auto-start user ${userId}:`, err),
        );
      }
    }

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
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator.ts
git commit -m "fix: debounce FSWatcher events and validate config before auto-starting users"
```

---

### Task 10: Docker port cleanup

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Remove dead port 6080, add comment**

Replace the ports section from:

```yaml
    ports:
      - "6080:6080"
      - "6081-6090:6081-6090"
```

to:

```yaml
    # Per-user noVNC ports (6081 = first user, 6082 = second, etc.)
    ports:
      - "6081-6090:6081-6090"
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: remove unused port 6080 from docker-compose"
```

---

### Task 11: Final build verification

- [ ] **Step 1: Build TypeScript**

Run: `npm run build`
Expected: Clean build with no errors

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Commit any remaining fixes if needed**

```bash
git add -A
git commit -m "fix: resolve any remaining build/test issues from overhaul"
```
