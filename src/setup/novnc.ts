import { spawn, type ChildProcess } from "node:child_process";
import { logger } from "../logger.js";
import { NOVNC_PORT, VNC_PORT, XVFB_SCREEN, NOVNC_STARTUP_DELAY_MS, NOVNC_WEBSOCKIFY_DELAY_MS } from "../constants.js";

const DISPLAY = ":99";

let xvfb: ChildProcess | null = null;
let x11vnc: ChildProcess | null = null;
let websockify: ChildProcess | null = null;

export async function startNoVnc(): Promise<string> {
  logger.info("[noVNC] Xvfb: Starting...");
  xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", XVFB_SCREEN], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  xvfb.on("error", (err) => logger.info(`[noVNC] Xvfb error: ${err.message}`));
  await sleep(NOVNC_STARTUP_DELAY_MS);
  logger.info("[noVNC] Xvfb: Started");

  logger.info("[noVNC] x11vnc: Starting...");
  x11vnc = spawn("x11vnc", ["-display", DISPLAY, "-nopw", "-listen", "localhost", "-forever", "-rfbport", String(VNC_PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  x11vnc.on("error", (err) => logger.info(`[noVNC] x11vnc error: ${err.message}`));
  x11vnc.stderr?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line.includes("listen") || line.includes("port") || line.includes("error")) {
      logger.info(`[noVNC] x11vnc: ${line}`);
    }
  });
  await sleep(NOVNC_STARTUP_DELAY_MS);
  logger.info("[noVNC] x11vnc: Started");

  logger.info(`[noVNC] websockify: Starting on port ${NOVNC_PORT}...`);
  websockify = spawn("websockify", ["--web", "/usr/share/novnc", String(NOVNC_PORT), `localhost:${VNC_PORT}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  websockify.on("error", (err) => logger.info(`[noVNC] websockify error: ${err.message}`));
  websockify.stderr?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    logger.info(`[noVNC] websockify: ${line}`);
  });
  await sleep(NOVNC_WEBSOCKIFY_DELAY_MS);
  logger.info("[noVNC] websockify: Started");

  const url = `http://localhost:${NOVNC_PORT}/vnc.html?autoconnect=true`;
  return url;
}

export function stopNoVnc(): void {
  logger.info("[noVNC] cleanup: Stopping all services");
  websockify?.kill();
  x11vnc?.kill();
  xvfb?.kill();
  websockify = null;
  x11vnc = null;
  xvfb = null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
