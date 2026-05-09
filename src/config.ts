import fs from "node:fs";
import type { AppConfig } from "./types.js";

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
