import puppeteer, { type Browser, type Page } from "puppeteer";
import fs from "node:fs";
import { logger } from "../logger.js";
import { BALE_URL, BROWSER_LAUNCH_ARGS, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, NAVIGATION_TIMEOUT_MS, SPA_RENDER_TIMEOUT_MS, CONTENT_RENDER_TIMEOUT_MS } from "../constants.js";

export interface BrowserSession {
  browser: Browser;
  page: Page;
  close: () => Promise<void>;
}

export async function launchBrowser(sessionDir: string): Promise<BrowserSession> {
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

  await page.waitForFunction(
    `!document.querySelector('.splash-container') && !document.querySelector('.spin')`,
    { timeout: SPA_RENDER_TIMEOUT_MS },
  );

  await page.waitForFunction(
    `document.querySelectorAll('span, button, input').length > 5`,
    { timeout: CONTENT_RENDER_TIMEOUT_MS },
  );
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  return !page.url().includes("/login");
}

export async function launchReloginBrowser(
  display: string,
  sessionDir: string,
): Promise<BrowserSession> {
  const lockFile = `${sessionDir}/SingletonLock`;
  try { fs.unlinkSync(lockFile); } catch {}

  const browser = await puppeteer.launch({
    headless: false,
    args: [...BROWSER_LAUNCH_ARGS, `--display=${display}`],
    userDataDir: sessionDir,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    env: { ...process.env, DISPLAY: display },
  });

  const page = await browser.newPage();
  await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });

  return { browser, page, close: () => browser.close() };
}
