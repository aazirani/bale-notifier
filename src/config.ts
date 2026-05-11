import fs from "node:fs";
import path from "node:path";
import type { AppConfig, MasterConfig } from "./types.js";
import { DEFAULT_NOVNC_PORT_RANGE, DEFAULT_LOGIN_TIMEOUT_MINUTES } from "./constants.js";

export function configExists(configPath: string): boolean {
  return fs.existsSync(configPath);
}

export function loadConfig(configPath: string): AppConfig {
  const raw = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as AppConfig;
}

export function saveConfig(configPath: string, config: AppConfig): void {
  const dir = configPath.substring(0, configPath.lastIndexOf("/"));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export function validateConfig(config: AppConfig): string[] {
  const errors: string[] = [];

  if (!config.bale?.sessionDir) {
    errors.push("bale.sessionDir is required");
  }

  if (!config.channel?.type) {
    errors.push("channel.type is required");
  } else {
    switch (config.channel.type) {
      case "telegram":
        if (!config.channel.telegram?.botToken) errors.push("channel.telegram.botToken is required");
        if (!config.channel.telegram?.chatId) errors.push("channel.telegram.chatId is required");
        break;
      case "discord":
        if (!config.channel.discord?.webhookUrl) {
          errors.push("channel.discord.webhookUrl is required");
        } else if (!isValidUrl(config.channel.discord.webhookUrl)) {
          errors.push("channel.discord.webhookUrl must be a valid URL");
        }
        break;
      case "slack":
        if (!config.channel.slack?.webhookUrl) {
          errors.push("channel.slack.webhookUrl is required");
        } else if (!isValidUrl(config.channel.slack.webhookUrl)) {
          errors.push("channel.slack.webhookUrl must be a valid URL");
        }
        break;
      default:
        errors.push(`unknown channel type: ${config.channel.type}`);
    }
  }

  if (config.notifications === undefined) {
    errors.push("notifications is required");
  }

  return errors;
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

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
      userPorts: {},
    };
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as MasterConfig;
  config.userPorts = config.userPorts ?? {};
  return config;
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
