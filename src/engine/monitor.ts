import type { AppConfig, BaleEvent, NotificationChannel, DecodedMessage } from "../types.js";
import { launchBrowser, navigateToBale } from "./browser.js";
import { WS_HOOK_SCRIPT } from "./ws-hook.js";
import { FrameDecoder } from "./decoder.js";
import { parseDecodedMessage } from "./event-parser.js";
import { startCallDetection } from "./call-detector.js";
import { createChannel } from "../channels/index.js";
import { logger } from "../logger.js";
import { RECONNECT_INITIAL_BACKOFF_MS, RECONNECT_MAX_BACKOFF_MS, KEEPALIVE_INTERVAL_MS, KEEPALIVE_CHECK_INTERVAL_MS, NOTIFICATION_MAX_RETRIES } from "../constants.js";

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

export class BaleMonitor {
  private channel: NotificationChannel;
  private running = false;
  private backoffMs = RECONNECT_INITIAL_BACKOFF_MS;
  private browserClose: (() => Promise<void>) | null = null;

  constructor(private config: AppConfig) {
    this.channel = createChannel(config);
  }

  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      try {
        await this.runSession();
      } catch (err) {
        logger.error(`Monitor error: ${err}`);
        logger.info(`Retrying in ${this.backoffMs}ms...`);
        await this.sleep(this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, RECONNECT_MAX_BACKOFF_MS);
      }
    }
  }

  stop(): void {
    this.running = false;
    this.browserClose?.().catch((err) => logger.debug("Browser close error:", err));
  }

  private async runSession(): Promise<void> {
    const session = await launchBrowser(this.config.bale.sessionDir);
    this.browserClose = session.close;

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
        throw new Error("Bale session expired — delete ./data/config.json and ./data/bale-session, then re-run setup to re-login");
      }

      // Start DOM-based call detection
      const stopCallDetection = await startCallDetection(session.page, async (callerName) => {
        logger.info(`Detected: incoming call from ${callerName}`);
        if (this.config.notifications.calls) {
          const event: BaleEvent = {
            type: "call",
            timestamp: new Date(),
            source: `Call from ${callerName}`,
          };
          await this.dispatch(event);
        }
      });

      logger.info("Connected to Bale. Monitoring for notifications via WebSocket...\n");

      this.backoffMs = RECONNECT_INITIAL_BACKOFF_MS;

      let keepalive: NodeJS.Timeout | null = null;
      let disconnected = false;

      keepalive = setInterval(async () => {
        if (disconnected) return;
        try {
          await session.page.evaluate("document.title");
        } catch {
          disconnected = true;
          session.browser.close().catch((err) => logger.debug("Browser close on disconnect error:", err));
        }
      }, KEEPALIVE_INTERVAL_MS);

      await new Promise<void>((resolve) => {
        session.browser.on("disconnected", () => {
          logger.info("Browser disconnected. Reconnecting...");
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
      await session.close();
      this.browserClose = null;
    }
  }

  private async handleDecodedMessage(_page: unknown, msg: DecodedMessage): Promise<void> {
    try {
      const event = parseDecodedMessage(msg);
      await this.dispatch(event);
    } catch (err) {
      logger.warn("Failed to dispatch event:", err);
    }
  }

  private async dispatch(event: BaleEvent): Promise<void> {
    for (let attempt = 1; attempt <= NOTIFICATION_MAX_RETRIES; attempt++) {
      try {
        await this.channel.send(event);
        logger.info(`[${event.timestamp.toISOString()}] Notified: ${event.type} in ${event.source}`);
        return;
      } catch (err) {
        if (attempt < NOTIFICATION_MAX_RETRIES) {
          logger.warn(`Notification attempt ${attempt} failed, retrying in ${RETRY_DELAYS_MS[attempt - 1]}ms...`, err);
          await this.sleep(RETRY_DELAYS_MS[attempt - 1]);
        } else {
          logger.error(`Failed to send notification after ${NOTIFICATION_MAX_RETRIES} attempts:`, err);
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
