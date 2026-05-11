import fs from "node:fs";
import path from "node:path";
import type { Protocol } from "puppeteer";

const COOKIES_FILE = "cookies.json";

export async function saveCookies(
  cookies: Protocol.Network.Cookie[],
  dir: string,
): Promise<void> {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, COOKIES_FILE);
  fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2), "utf-8");
}

export async function loadCookies(
  dir: string,
): Promise<Protocol.Network.Cookie[]> {
  const filePath = path.join(dir, COOKIES_FILE);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as Protocol.Network.Cookie[];
}
