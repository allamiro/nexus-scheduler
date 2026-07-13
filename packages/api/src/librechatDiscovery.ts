export interface DiscoveredAgent {
  id: string;
  name: string | null;
}

// REQUIREMENTS §2.1 "Agent discovery": rather than requiring a
// hand-typed LibreChat agent ID, list the Agents available to a given
// API key so the Job form can offer a picker — falling back to manual
// entry if discovery isn't available. LibreChat's Agents API is
// OpenAI-compatible (§2.1) and its chat-completions endpoint already
// lives at /api/agents/v1/chat/completions; this assumes the sibling
// GET /api/agents/v1/models endpoint OpenAI's own convention implies,
// which hasn't been independently confirmed against a live LibreChat
// deployment (§14's open confirmation item). Any failure here — 404,
// network error, unexpected response shape — is deliberately treated
// as "discovery isn't available" by the caller (a plain thrown Error),
// never as something that should break Job creation.
async function listAgentIdsFromModelsEndpoint(
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<DiscoveredAgent[]> {
  const response = await fetch(`${baseUrl}/api/agents/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!response.ok) {
    throw new Error(`LibreChat responded ${response.status}`);
  }
  const body = (await response.json()) as { data?: unknown };
  if (!Array.isArray(body.data)) {
    throw new Error("unexpected response shape from LibreChat's models endpoint");
  }
  return body.data
    .map((entry) => {
      if (!entry || typeof entry !== "object") return undefined;
      const id = (entry as { id?: unknown }).id;
      if (typeof id !== "string" || id.length === 0) return undefined;
      // The OpenAI /v1/models convention this endpoint is presumed to
      // follow only guarantees `id` — but some LibreChat configurations
      // attach the Agent's display name here too (`name`, or a `label`
      // some proxies use), so grab it opportunistically if present
      // rather than assuming it never will be.
      const name = (entry as { name?: unknown; label?: unknown }).name ?? (entry as { label?: unknown }).label;
      return { id, name: typeof name === "string" && name.length > 0 ? name : null };
    })
    .filter((entry): entry is DiscoveredAgent => entry !== undefined);
}

// Best-effort enrichment only — LibreChat's own Agent Builder listing
// (`GET /api/agents`, what its web UI uses to show "My Agents") returns
// each Agent's actual display `name`, unlike the bare OpenAI-style model
// IDs above. It's normally guarded by LibreChat's own session/JWT auth
// rather than the Bearer API-key auth this app holds, so this may well
// 401/404 — never independently confirmed against a live deployment,
// same caveat as the primary endpoint above. Any failure here is
// swallowed: the picker still works with IDs alone, it just won't show
// friendlier names.
async function tryEnrichWithAgentNames(
  baseUrl: string,
  apiKey: string,
  agents: DiscoveredAgent[],
  signal: AbortSignal,
): Promise<DiscoveredAgent[]> {
  try {
    const response = await fetch(`${baseUrl}/api/agents`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!response.ok) {
      return agents;
    }
    const body = (await response.json()) as { data?: unknown };
    const rows = Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : undefined;
    if (!Array.isArray(rows)) {
      return agents;
    }
    const namesById = new Map<string, string>();
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const id = (row as { id?: unknown }).id;
      const name = (row as { name?: unknown }).name;
      if (typeof id === "string" && typeof name === "string" && name.length > 0) {
        namesById.set(id, name);
      }
    }
    if (namesById.size === 0) {
      return agents;
    }
    return agents.map((agent) => ({ id: agent.id, name: namesById.get(agent.id) ?? agent.name }));
  } catch {
    return agents;
  }
}

export async function listLibreChatAgents(
  baseUrl: string,
  apiKey: string,
  timeoutMs = 10_000,
): Promise<DiscoveredAgent[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const agents = await listAgentIdsFromModelsEndpoint(baseUrl, apiKey, controller.signal);
    return await tryEnrichWithAgentNames(baseUrl, apiKey, agents, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}
