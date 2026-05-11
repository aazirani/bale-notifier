import fs from "node:fs";
import path from "node:path";
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

    if (!fs.existsSync(this.usersDir)) {
      fs.mkdirSync(this.usersDir, { recursive: true });
    }

    if (!fs.existsSync(this.masterConfigPath)) {
      saveMasterConfig(this.masterConfigPath, this.masterConfig);
    }

    logger.info("Launching shared headless browser...");
    this.browser = await launchSharedBrowser();
    logger.info("Shared browser launched.\n");

    const userIds = discoverUsers(this.usersDir);
    for (const userId of userIds) {
      await this.startUser(userId);
    }

    logger.info(`Orchestrator started with ${userIds.length} user(s).\n`);

    this.watcher = fs.watch(this.usersDir, () => {
      this.onUsersDirChange();
    });

    this.stateSaveInterval = setInterval(() => {
      this.saveState().catch((err) => logger.error("Failed to save state:", err));
    }, STATE_SAVE_INTERVAL_MS);

    await this.saveState();
  }

  async stop(): Promise<void> {
    logger.info("Stopping orchestrator...");

    if (this.stateSaveInterval) {
      clearInterval(this.stateSaveInterval);
    }
    this.watcher?.close();

    for (const [userId, session] of this.sessions) {
      logger.info(`Stopping monitor for ${userId}...`);
      session.monitor.stop();
      session.status = "stopped";
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));

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
    const session = this.sessions.get(userId);
    if (session) {
      session.monitor.stop();
      this.sessions.delete(userId);
    }

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

    for (const userId of currentUsers) {
      if (!runningUsers.has(userId)) {
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
}
