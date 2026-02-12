import { Redis } from "ioredis";
import { env } from "./env.js";

type Listener = (message: string) => void;

const sub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const listenersByChannel = new Map<string, Set<Listener>>();

sub.on("message", (channel, message) => {
  const listeners = listenersByChannel.get(channel);
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) {
    try {
      listener(message);
    } catch {
      // ignore listener errors
    }
  }
});

export const subscribeChannel = async (channel: string, listener: Listener): Promise<() => Promise<void>> => {
  let set = listenersByChannel.get(channel);
  if (!set) {
    set = new Set();
    listenersByChannel.set(channel, set);
    await sub.subscribe(channel);
  } else if (set.size === 0) {
    await sub.subscribe(channel);
  }

  set.add(listener);

  return async () => {
    const current = listenersByChannel.get(channel);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      try {
        await sub.unsubscribe(channel);
      } catch {
        // ignore
      }
    }
  };
};

