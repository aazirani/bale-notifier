// Timeouts
export const LOGIN_TIMEOUT_MS = 300_000;
export const RELOGIN_TIMEOUT_MS = 600_000;
export const NAVIGATION_TIMEOUT_MS = 60_000;
export const SPA_RENDER_TIMEOUT_MS = 60_000;
export const CONTENT_RENDER_TIMEOUT_MS = 30_000;
export const RECONNECT_INITIAL_BACKOFF_MS = 1_000;
export const RECONNECT_MAX_BACKOFF_MS = 60_000;
export const KEEPALIVE_INTERVAL_MS = 30 * 60 * 1000;
export const RELOGIN_COOLDOWN_MS = 30 * 60 * 1000;
export const KEEPALIVE_CHECK_INTERVAL_MS = 1_000;
export const NOVNC_STARTUP_DELAY_MS = 1_000;
export const NOVNC_WEBSOCKIFY_DELAY_MS = 1_500;

// Network
export const NOTIFICATION_MAX_RETRIES = 3;

// Ports
export const NOVNC_PORT = Number(process.env.NOVNC_PORT) || 6080;
export const VNC_PORT = Number(process.env.VNC_PORT) || 5900;

// Display
export const VIEWPORT_WIDTH = 1280;
export const VIEWPORT_HEIGHT = 720;
export const XVFB_SCREEN = "1280x720x24";

// Paths
export const BALE_URL = "https://web.bale.ai";
export const DEFAULT_CONFIG_PATH = "/data/config.json";
export const DEFAULT_SESSION_DIR = "/data/bale-session";

// Browser
export const BROWSER_LAUNCH_ARGS = [
  "--disable-gpu",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
];

// Decoder
export const DEDUP_BUFFER_SIZE = 100;
export const PREVIEW_MAX_LENGTH = 100;

// Multi-Tenant
export const DEFAULT_USERS_DIR = "/data/users";
export const DEFAULT_MASTER_CONFIG_PATH = "/data/master.json";
export const DEFAULT_STATE_PATH = "/data/state.json";
export const DEFAULT_NOVNC_PORT_RANGE: [number, number] = [6081, 6090];
export const DEFAULT_LOGIN_TIMEOUT_MINUTES = 15;
export const STATE_SAVE_INTERVAL_MS = 30_000;
export const USER_SCAN_INTERVAL_MS = 15_000;
