import { configExists, loadConfig, validateConfig } from "./config.js";
import { BaleMonitor } from "./engine/monitor.js";
import { runWizard } from "./setup/wizard.js";
import { logger } from "./logger.js";
import { DEFAULT_CONFIG_PATH } from "./constants.js";

const CONFIG_PATH = process.env.CONFIG_PATH ?? DEFAULT_CONFIG_PATH;

async function main(): Promise<void> {
  logger.info("Bale Notifier v1.0.0\n");

  let config;

  if (!configExists(CONFIG_PATH)) {
    logger.info("No configuration found. Starting setup wizard...\n");
    config = await runWizard(CONFIG_PATH);
  } else {
    config = loadConfig(CONFIG_PATH);
    const errors = validateConfig(config);
    if (errors.length > 0) {
      logger.error("Invalid config:", errors.join(", "));
      logger.info("Re-running setup wizard...\n");
      config = await runWizard(CONFIG_PATH);
    }
  }

  const monitor = new BaleMonitor(config);

  const shutdown = () => {
    logger.info("\nShutting down...");
    monitor.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logger.info("Starting Bale monitor...\n");
  await monitor.start();
}

main().catch((err) => {
  logger.error("Fatal error:", err);
  process.exit(1);
});