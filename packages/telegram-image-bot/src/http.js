import { HttpsProxyAgent } from "https-proxy-agent";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { config } from "./config.js";
import { log } from "./logger.js";

/**
 * Optional outbound proxy, for networks where api.telegram.org is not reachable directly.
 *
 * Two clients need it and they take different objects: Telegraf talks through node-fetch and
 * wants an http.Agent, while our own downloads and AI calls go through fetch and want an undici
 * dispatcher. Both are built from the same URL so a single PROXY_URL configures everything.
 */

/** @type {import("https-proxy-agent").HttpsProxyAgent<string>|undefined} */
export const telegramAgent = config.proxyUrl ? new HttpsProxyAgent(config.proxyUrl) : undefined;

const dispatcher = config.proxyUrl ? new ProxyAgent(config.proxyUrl) : undefined;

/** fetch(), routed through the configured proxy when there is one. */
export function httpFetch(url, options = {}) {
  return dispatcher ? undiciFetch(url, { ...options, dispatcher }) : fetch(url, options);
}

if (config.proxyUrl) {
  // Log the endpoint but never the credentials a proxy URL may carry.
  const safe = new URL(config.proxyUrl);
  safe.username = "";
  safe.password = "";
  log.info(`outbound traffic routed through proxy ${safe.origin}`);
}
