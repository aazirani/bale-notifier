import input from "@inquirer/input";
import select from "@inquirer/select";
import confirm from "@inquirer/confirm";
import puppeteer from "puppeteer";
import fs from "node:fs";
import type { AppConfig, ChannelType } from "../types.js";
import { saveConfig } from "../config.js";
import { startNoVnc, stopNoVnc } from "./novnc.js";
import { logger } from "../logger.js";
import { BALE_URL, DEFAULT_CONFIG_PATH, BROWSER_LAUNCH_ARGS, NAVIGATION_TIMEOUT_MS, SPA_RENDER_TIMEOUT_MS, CONTENT_RENDER_TIMEOUT_MS, LOGIN_TIMEOUT_MS } from "../constants.js";
import { createChannel } from "../channels/index.js";

function sessionDirFromConfigPath(configPath: string): string {
  const dataDir = configPath.substring(0, configPath.lastIndexOf("/"));
  return `${dataDir}/bale-session`;
}

function isHeadless(): boolean {
  // No DISPLAY or DISPLAY=:99 (Xvfb) means headless
  return !process.env.DISPLAY || process.env.DISPLAY === ":99" || process.env.DISPLAY === "";
}

export async function runWizard(configPath = DEFAULT_CONFIG_PATH, explicitSessionDir?: string, serverIp?: string): Promise<AppConfig> {
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
  logger.info("Setup complete. Monitoring Bale for notifications.\n");

  validateSessionDir(sessionDir);

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
      // Wait until login content disappears and URL no longer contains /login
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

  const channelType = await select({
    message: "Where do you want to receive notifications?",
    choices: [
      { value: "telegram" as ChannelType, name: "Telegram" },
      { value: "discord" as ChannelType, name: "Discord" },
      { value: "slack" as ChannelType, name: "Slack" },
    ],
  });

  while (true) {
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

    // Validate credentials
    logger.info("\nValidating channel credentials...");
    const tempConfig: AppConfig = {
      bale: { sessionDir: "" }, // Not used for validation
      channel: channelConfig,
      notifications: { messages: true, calls: true, groups: true },
    };
    const channel = createChannel(tempConfig);
    const isValid = await channel.validateConfig();

    if (isValid) {
      logger.info("Channel credentials validated successfully.\n");
      return channelConfig;
    }

    logger.warn("Channel validation failed. The credentials may be incorrect.\n");
    const retry = await confirm({ message: "Would you like to try again?", default: true });
    if (!retry) {
      logger.warn("Continuing with unvalidated credentials. Notifications may not work.\n");
      return channelConfig;
    }
    logger.info("");
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
