// Shared between the API (requests cancellation) and the Worker
// (fulfills it) — same rationale as queue.ts: one definition of the
// Redis key/channel names so the two processes agree on the wire shape
// without this package depending on either's Redis client library.
//
// RUN_CANCEL_REQUESTED_KEY is a Set of Run ids whose cancellation has
// been requested but not yet fulfilled — durable, so a request made
// while a Run is still queued (not yet picked up by any worker) isn't
// lost. The Worker removes an id from the Set once it has honored the
// request (or found the Run already terminal), so the Set only ever
// holds outstanding requests.
//
// RUN_CANCEL_CHANNEL is a best-effort pub/sub nudge on top of that: if
// a Run is actively mid-flight (a worker replica is waiting on
// LibreChat right now), the Set alone wouldn't be noticed until that
// call finishes naturally. Every worker replica subscribes; whichever
// one is actually holding that Run's in-flight request aborts it
// immediately, the rest no-op.
export const RUN_CANCEL_REQUESTED_KEY = "nexus:run-cancel-requested";
export const RUN_CANCEL_CHANNEL = "nexus:run-cancel";
