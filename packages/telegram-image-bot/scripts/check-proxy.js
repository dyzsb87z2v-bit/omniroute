/**
 * Verify that outbound traffic really goes through PROXY_URL.
 * Usage: PROXY_URL=http://127.0.0.1:8080 node scripts/check-proxy.js [test-url]
 */
import { config } from "../src/config.js";
import { httpFetch, telegramAgent } from "../src/http.js";

const target = process.argv[2] || "https://api.telegram.org";
console.log(`\nproxy: ${config.proxyUrl || "(none — direct connection)"}`);
console.log(`telegraf agent: ${telegramAgent ? "configured" : "none"}`);
console.log(`probing ${target} …\n`);

try {
  const res = await httpFetch(target, { signal: AbortSignal.timeout(20000) });
  console.log(`  reachable — HTTP ${res.status}\n`);
} catch (err) {
  console.log(`  NOT reachable — ${err.cause?.message ?? err.message}\n`);
  process.exit(1);
}
