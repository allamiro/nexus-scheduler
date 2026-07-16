import { RUN_CANCEL_CHANNEL, RUN_CANCEL_REQUESTED_KEY } from "@nexus-scheduler/shared";
import type { RedisClient } from "bullmq";
import type { Logger } from "./logger.js";

// BullMQ's RedisClient type is a narrow, hand-curated interface (see
// concurrency.ts for the same pattern/rationale) — the actual runtime
// object is a full ioredis instance, which really does support these
// commands, just not declared on that narrower type.
interface RawCommandClient {
  sadd(key: string, member: string): Promise<number>;
  srem(key: string, member: string): Promise<number>;
  sismember(key: string, member: string): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
  duplicate(): PubSubClient;
}

interface PubSubClient {
  subscribe(channel: string): Promise<unknown>;
  on(event: "message", listener: (channel: string, message: string) => void): void;
  quit(): Promise<unknown>;
}

export async function isCancelRequested(client: RedisClient, runId: string): Promise<boolean> {
  const raw = client as unknown as RawCommandClient;
  return (await raw.sismember(RUN_CANCEL_REQUESTED_KEY, runId)) === 1;
}

export async function clearCancelRequest(client: RedisClient, runId: string): Promise<void> {
  const raw = client as unknown as RawCommandClient;
  await raw.srem(RUN_CANCEL_REQUESTED_KEY, runId);
}

// In-memory, per-worker-process registry of the AbortController backing
// whichever Run this replica currently has an in-flight LibreChat call
// for. Deliberately local rather than shared via Redis: only the
// process that actually opened the fetch can abort it, so every
// replica's subscriber (below) only needs to know "is it me?" — a
// broadcast pub/sub message answers that for free, since every replica
// gets it and only the right one finds an entry here.
const activeControllers = new Map<string, AbortController>();

export function registerActiveRun(runId: string): AbortController {
  const controller = new AbortController();
  activeControllers.set(runId, controller);
  return controller;
}

export function unregisterActiveRun(runId: string): void {
  activeControllers.delete(runId);
}

// Subscribes this replica to cancellation nudges. A dedicated
// (duplicated) connection is required — once a Redis connection issues
// SUBSCRIBE it can only be used for pub/sub commands, so it can't be
// the same connection BullMQ's Worker/the concurrency slot script are
// already running other commands on.
export async function startCancellationSubscriber(
  client: RedisClient,
  logger: Logger,
): Promise<() => Promise<void>> {
  const subscriber = (client as unknown as RawCommandClient).duplicate();
  await subscriber.subscribe(RUN_CANCEL_CHANNEL);
  subscriber.on("message", (_channel, runId) => {
    const controller = activeControllers.get(runId);
    if (controller) {
      controller.abort();
    }
    // No entry: this replica isn't the one processing that Run right
    // now (already finished, still queued, or being handled by a
    // different replica) — nothing to do here, the durable Set in
    // isCancelRequested/clearCancelRequest is what catches those cases.
  });
  logger.info("subscribed to run-cancellation channel");
  return async () => {
    await subscriber.quit();
  };
}
