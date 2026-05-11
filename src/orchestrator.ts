import fs from "node:fs";
import path from "node:path";
import type { AppConfig, MasterConfig, UserState } from "./types.js";
import { BaleMonitor } from "./engine/monitor.js";
import {
  discoverUsers,
  loadMasterConfig,
  saveMasterConfig,
  loadUserConfig,
} from "./config.js";
import { logger } from "./logger.js";
import {
  STATE_SAVE_INTERVAL_MS,
} from "./constants.js";

interface UserSession {
  userId: string;
  config: AppConfig;
  monitor: BaleMonitor;
  status: UserState["status"];
}

export class Orchestrator {
  private sessions = new Map<string, UserSession>();
  private masterConfig: MasterConfig;
  private masterConfigPath: string;
  private usersDir: string;
  private statePath: string;
  private stateSaveInterval: NodeJS.Timeout | null = null;
  private watcher: fs.FSWatcher | null = null;
  private configWatchers: Map<string, fs.FSWatcher> = new Map();
  private watcherTimer: NodeJS.Timeout | null = null;

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

    const userIds = discoverUsers(this.usersDir);
    for (const userId of userIds) {
      await this.startUser(userId);
    }

    logger.info(`Orchestrator started with ${userIds.length} user(s).\n`);

    this.watcher = fs.watch(this.usersDir, () => {
      if (this.watcherTimer) clearTimeout(this.watcherTimer);
      this.watcherTimer = setTimeout(() => {
        this.watcherTimer = null;
        this.onUsersDirChange();
      }, 2000);
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
    if (this.watcherTimer) {
      clearTimeout(this.watcherTimer);
      this.watcherTimer = null;
    }
    this.watcher?.close();
    for (const [userId] of this.configWatchers) {
      this.unwatchUserConfig(userId);
    }

    for (const [userId, session] of this.sessions) {
      logger.info(`Stopping monitor for ${userId}...`);
      session.monitor.stop();
      session.status = "stopped";
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));

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
      this.unwatchUserConfig(userId);
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

    try {
      const config = loadUserConfig(this.usersDir, userId);
      const port = this.allocatePort(userId);
      const vncPort = port + 900;

      const monitor = new BaleMonitor(
        config,
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
      this.watchUserConfig(userId);
      logger.info(`Started monitor for user ${userId} (noVNC port: ${port})`);
    } catch (err) {
      logger.error(`Failed to start user ${userId}:`, err);
    }
  }

  private allocatePort(userId: string): number {
    if (this.masterConfig.userPorts[userId] !== undefined) {
      return this.masterConfig.userPorts[userId];
    }

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

  private onUsersDirChange(): void {
    const currentUsers = new Set(discoverUsers(this.usersDir));
    const runningUsers = new Set(this.sessions.keys());

    for (const userId of currentUsers) {
      if (!runningUsers.has(userId)) {
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
          this.unwatchUserConfig(userId);
          session.monitor.stop();
          this.sessions.delete(userId);
          logger.info(`Auto-stopped removed user ${userId}`);
        }
      }
    }
  }

  private watchUserConfig(userId: string): void {
    const configPath = path.join(this.usersDir, userId, "config.json");
    let timer: NodeJS.Timeout | null = null;
    try {
      const watcher = fs.watch(configPath, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          this.onUserConfigChange(userId);
        }, 1000);
      });
      this.configWatchers.set(userId, watcher);
    } catch {
      // File may not exist yet
    }
  }

  private unwatchUserConfig(userId: string): void {
    const watcher = this.configWatchers.get(userId);
    if (watcher) {
      watcher.close();
      this.configWatchers.delete(userId);
    }
  }

  private onUserConfigChange(userId: string): void {
    const session = this.sessions.get(userId);
    if (!session) return;

    try {
      const newConfig = loadUserConfig(this.usersDir, userId);
      session.config = newConfig;
      session.monitor.reloadConfig(newConfig);
    } catch (err) {
      logger.warn(`Failed to reload config for ${userId}:`, err);
    }
  }
}
