import { Orchestrator } from "./orchestrator.js";
import { handleCli } from "./cli.js";
import { logger } from "./logger.js";

const DATA_DIR = process.env.DATA_DIR || "/data";

async function main(): Promise<void> {
  logger.info("Bale Notifier v2.0.0 (multi-tenant)\n");

  const orchestrator = new Orchestrator(DATA_DIR);

  const shutdown = () => {
    logger.info("\nShutting down...");
    orchestrator.stop().then(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await orchestrator.start();
}

const args = process.argv.slice(2);
if (args.length > 0) {
  handleCli(args[0]).catch((err) => {
    logger.error("CLI error:", err);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    logger.error("Fatal error:", err);
    process.exit(1);
  });
}
