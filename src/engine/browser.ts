import puppeteer, { type Browser, type Page } from "puppeteer";
import type { BrowserContext } from "puppeteer";
import fs from "node:fs";
import { logger } from "../logger.js";
import { BALE_URL, BROWSER_LAUNCH_ARGS, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, NAVIGATION_TIMEOUT_MS, SPA_RENDER_TIMEOUT_MS, CONTENT_RENDER_TIMEOUT_MS } from "../constants.js";
import { loadCookies, saveCookies } from "../cookies.js";

export interface BrowserSession {
  browser: Browser;
  page: Page;
  close: () => Promise<void>;
}

export async function launchBrowser(sessionDir: string): Promise<BrowserSession> {
  // Clean up stale Chromium lock files from previous runs
  const lockFile = `${sessionDir}/SingletonLock`;
  try { fs.unlinkSync(lockFile); } catch (err) { logger.debug("No stale lock file to clean:", err); }

  const browser = await puppeteer.launch({
    headless: true,
    args: BROWSER_LAUNCH_ARGS,
    userDataDir: sessionDir,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });

  return { browser, page, close: () => browser.close() };
}

export async function navigateToBale(page: Page): Promise<void> {
  await page.goto(BALE_URL, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });

  // Wait for the React SPA to finish loading (splash screen to disappear)
  await page.waitForFunction(
    `!document.querySelector('.splash-container') && !document.querySelector('.spin')`,
    { timeout: SPA_RENDER_TIMEOUT_MS },
  );

  // Wait for actual content to render (chat list or login form)
  await page.waitForFunction(
    `document.querySelectorAll('span, button, input').length > 5`,
    { timeout: CONTENT_RENDER_TIMEOUT_MS },
  );
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  return !page.url().includes("/login");
}

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
    await page.setCookie(...(cookies as any));
  }

  const close = async () => {
    // Save cookies before closing
    try {
      const currentCookies = await page.cookies();
      await saveCookies(currentCookies as any, sessionDir);
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
    await page.setCookie(...(cookies as any));
  }

  return { browser, page };
}