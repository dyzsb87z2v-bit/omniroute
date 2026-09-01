import { config } from "./config.js";

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const active = LEVELS[config.logLevel] ?? LEVELS.info;

function emit(level, args) {
  if (LEVELS[level] > active) return;
  const stamp = new Date().toISOString();
  const line = `${stamp} ${level.toUpperCase().padEnd(5)}`;
  const sink = level === "error" ? console.error : console.log;
  sink(line, ...args);
}

export const log = {
  error: (...a) => emit("error", a),
  warn: (...a) => emit("warn", a),
  info: (...a) => emit("info", a),
  debug: (...a) => emit("debug", a),
};
