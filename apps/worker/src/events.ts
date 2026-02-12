import { Redis } from "ioredis";
import { env } from "./env.js";

let _pub: Redis | null = null;

const getPublisher = (): Redis => {
  if (!_pub) {
    _pub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return _pub;
};

export const publishEvent = async (channel: string, payload: unknown): Promise<void> => {
  try {
    const pub = getPublisher();
    await pub.publish(channel, JSON.stringify(payload));
  } catch {
    // Best-effort: realtime updates should not break the job.
  }
};

