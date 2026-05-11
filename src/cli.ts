import input from "@inquirer/input";
import confirm from "@inquirer/confirm";
import fs from "node:fs";
import path from "node:path";
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
    logger.info("The server IP is used in noVNC re-login links when Bale sessions expire.");
    logger.info("Enter the IP or hostname that you use to access this server from your browser.\n");
    const ip = await input({
      message: "Server IP or hostname:",
      validate: (v) => v.trim() ? true : "Server IP is required",
    });
    masterConfig.serverIp = ip.trim();
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
