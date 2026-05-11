import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { logger } from "../logger.js";
import { XVFB_SCREEN, NOVNC_STARTUP_DELAY_MS, NOVNC_WEBSOCKIFY_DELAY_MS } from "../constants.js";

const DISPLAY = process.env.DISPLAY || ":99";

// Shared Xvfb — started once, reused by all NoVncSessions
let sharedXvfb: ChildProcess | null = null;
let xvfbStarted = false;

async function ensureXvfb(): Promise<void> {
  if (xvfbStarted) return;
  xvfbStarted = true;

  try {
    sharedXvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", XVFB_SCREEN], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    sharedXvfb.on("error", (err) => logger.debug(`[noVNC] Xvfb error: ${err.message}`));
    await sleep(NOVNC_STARTUP_DELAY_MS);
    logger.info("[noVNC] Xvfb: Started");
  } catch {
    logger.debug("[noVNC] Xvfb already running or failed to start");
  }
}

export class NoVncSession {
  private x11vnc: ChildProcess | null = null;
  private websockify: ChildProcess | null = null;
  private token = crypto.randomBytes(16).toString("hex");

  constructor(
    private readonly port: number,
    private readonly vncPort: number,
  ) {}

  async start(): Promise<string> {
    await ensureXvfb();

    this.x11vnc = spawn("x11vnc", [
      "-display", DISPLAY,
      "-nopw",
      "-q",
      "-listen", "localhost",
      "-forever",
      "-rfbport", String(this.vncPort),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    this.x11vnc.on("error", (err) => logger.debug(`[noVNC] x11vnc error: ${err.message}`));
    let x11vncReady = false;
    this.x11vnc.stderr?.on("data", (d: Buffer) => {
      if (x11vncReady) return;
      const line = d.toString().trim();
      if (line.includes("Listening for VNC connections")) {
        logger.info(`[noVNC] x11vnc: Listening on VNC port ${this.vncPort}`);
        x11vncReady = true;
      }
    });
    await sleep(NOVNC_STARTUP_DELAY_MS);

    this.websockify = spawn("websockify", [
      "--web", "/usr/share/novnc",
      String(this.port),
      `localhost:${this.vncPort}`,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    this.websockify.on("error", (err) => logger.debug(`[noVNC] websockify error: ${err.message}`));
    let websockifyReady = false;
    this.websockify.stderr?.on("data", (d: Buffer) => {
      if (websockifyReady) return;
      const line = d.toString().trim();
      if (line.includes("proxying from")) {
        logger.info(`[noVNC] websockify: Ready on port ${this.port}`);
        websockifyReady = true;
      }
    });
    await sleep(NOVNC_WEBSOCKIFY_DELAY_MS);

    return `http://localhost:${this.port}/vnc.html?autoconnect=true&token=${this.token}`;
  }

  stop(): void {
    this.x11vnc?.stderr?.removeAllListeners();
    this.websockify?.stderr?.removeAllListeners();
    this.websockify?.kill();
    this.x11vnc?.kill();
    this.websockify = null;
    this.x11vnc = null;
  }

  get display(): string {
    return DISPLAY;
  }
}

// Legacy single-user functions (used by wizard during add-user)
let activeLegacySession: NoVncSession | null = null;

export async function startNoVnc(): Promise<string> {
  const port = Number(process.env.NOVNC_PORT) || 6080;
  const vncPort = Number(process.env.VNC_PORT) || 5900;
  const session = new NoVncSession(port, vncPort);
  activeLegacySession = session;
  return session.start();
}

export function stopNoVnc(): void {
  activeLegacySession?.stop();
  activeLegacySession = null;
}

export function isXvfbRunning(): boolean {
  return xvfbStarted && sharedXvfb !== null && !sharedXvfb.killed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
