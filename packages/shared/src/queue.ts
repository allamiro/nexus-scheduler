// Shared between the API (enqueues "Run Now" manual triggers, §2.1) and
// the Worker (enqueues scheduled runs, and is the only consumer) — one
// definition of the queue name and job payload shape so the two can
// never drift apart. Deliberately doesn't import bullmq here: this
// package has no business depending on a queue library, just agreeing
// on the wire shape.
//
// No colon in the name: BullMQ uses `:` internally to namespace its own
// Redis keys and rejects a queue name containing one ("Queue name
// cannot contain :"), thrown synchronously from `new Queue(...)` — this
// took down the API and Worker on every startup.
export const RUNS_QUEUE_NAME = "nexus-scheduler-runs";

export interface RunJobData {
  runId: string;
}
