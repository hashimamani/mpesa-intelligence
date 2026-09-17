import IORedis from "ioredis";
import { loadApiConfig } from "@mpesa/config";

/**
 * BullMQ requires its own Redis connection (not shared with the health-check
 * client) and specifically `maxRetriesPerRequest: null` — see BullMQ's docs;
 * without it, blocking commands used internally time out incorrectly.
 */
export function createQueueRedisConnection(): IORedis {
  const config = loadApiConfig();
  return new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
}
