import type { Browser } from "puppeteer";
import type { AppConfig, BaleEvent, NotificationChannel, DecodedMessage } from "../types.js";
import { createUserContext, navigateToBale, launchReloginBrowser } from "./browser.js";
import { WS_HOOK_SCRIPT } from "./ws-hook.js";
import { FrameDecoder } from "./decoder.js";
import { parseDecodedMessage } from "./event-parser.js";
import { startCallDetection } from "./call-detector.js";
import { createChannel } from "../channels/index.js";
import { NoVncSession } from "../setup/novnc.js";
import { saveCookies } from "../cookies.js";
import { saveLocalStorage } from "../storage.js";
import { logger } from "../logger.js";
import {
  RECONNECT_INITIAL_BACKOFF_MS,
  RECONNECT_MAX_BACKOFF_MS,
  KEEPALIVE_INTERVAL_MS,
  KEEPALIVE_CHECK_INTERVAL_MS,
  NOTIFICATION_MAX_RETRIES,
  BALE_URL,
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
        if (decoded) {
          if (this.config.notifications.messages) {
            this.handleDecodedMessage(session.page, decoded);
          }
        } else {
          const hex = Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, "0")).join(" ");
          logger.debug(`[${this.userId}] WS frame not decoded (${bytes.length} bytes, first 8: ${hex})`);
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

      const cookies = await page.cookies() as any;
      await saveCookies(cookies, this.config.bale.sessionDir);

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
