import { Redis } from "ioredis";
import { Queue } from "bullmq";
import { QUEUE_NAME } from "@exametest/shared";
import { env } from "./env.js";

export const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null
});

export const queue = new Queue(QUEUE_NAME, { connection });
