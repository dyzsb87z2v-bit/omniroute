import fs from "node:fs/promises";
import { config, assertRunnable } from "./config.js";
import { createBot } from "./bot.js";
import { log } from "./logger.js";

try {
  assertRunnable();
} catch (err) {
  log.error(err.message);
  process.exit(1);
}

await fs.mkdir(config.workDir, { recursive: true });

const bot = createBot();

log.info(
  `starting bot — output ${config.output.width}x${config.output.height} ` +
    `${config.output.format} q${config.output.quality}, ` +
    `AI layer ${config.ai.enabled ? `on (${config.ai.model})` : "off"}`
);

await bot.launch({ dropPendingUpdates: true }, () => log.info("bot is polling for updates"));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    log.info(`${signal} received, stopping`);
    bot.stop(signal);
  });
}
