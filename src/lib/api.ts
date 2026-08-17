import type { ChangeIntelligenceObject, ConsumerMapping, PublisherSnapshot } from "../shared/index.js";

/** Carries the parsed error body alongside the status, so callers can react to specific
 * shapes (e.g. a 409's `existingProducerId`) instead of string-matching an error message. */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, url: string, body: unknown) {
    super(`${status} ${url}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(url: string, token: string, options: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers },
  });
  const body = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  if (!response.ok) {
    throw new ApiError(response.status, url, body);
  }
  return { status: response.status, body };
}

export type WhoAmI =
  | { kind: "producer_key"; producerId: string; producerSlug: string; producerName: string }
  | { kind: "consumer_key"; consumerId: string; consumerName: string; producerId: string; producerSlug: string; producerName: string };

export async function whoami(bruceApiUrl: string, token: string): Promise<WhoAmI> {
  const { body } = await request<WhoAmI>(`${bruceApiUrl}/api/whoami`, token);
  return body;
}

/**
 * Auto-discovery onboarding (DESIGN_NOTES.md §17): self-registers a new
 * producer using an owner's agent_key instead of a pre-existing producer
 * key pasted from the dashboard. On a slug collision (409 — this owner
 * already has a producer with that slug) the caller should retry once with
 * a disambiguated slug; this function doesn't retry on its own since it has
 * no opinion on naming, only on the HTTP call.
 */
export async function createProducer(
  bruceApiUrl: string,
  agentKey: string,
  name: string,
  slug: string,
): Promise<{ producerId: string; producerSlug: string; producerName: string; apiKey: string }> {
  const { body } = await request<{ producer: { id: string; name: string; slug: string }; apiKey: string }>(
    `${bruceApiUrl}/api/producers`,
    agentKey,
    { method: "POST", body: JSON.stringify({ name, slug }) },
  );
  return { producerId: body.producer.id, producerSlug: body.producer.slug, producerName: body.producer.name, apiKey: body.apiKey };
}

/**
 * Registers a database (Postgres/Supabase) as a producer — the CLI-driven counterpart to the
 * dashboard's "Connect a database" flow, for an auto-discovery session that finds a
 * DATABASE_URL/Supabase connection in a repo it's scanning. Returns setup SQL, not a key — the
 * caller (human or Claude) still has to actually run it against the target database; this
 * command only ever registers the producer, it never touches the database itself.
 */
export async function createDbProducer(
  bruceApiUrl: string,
  agentKey: string,
  name: string,
  slug: string,
): Promise<{ producerId: string; producerSlug: string; producerName: string; webhookUrl: string; setupSql: string }> {
  const { body } = await request<{ producer: { id: string; name: string; slug: string }; dbSetup: { webhookUrl: string; setupSql: string } }>(
    `${bruceApiUrl}/api/producers`,
    agentKey,
    { method: "POST", body: JSON.stringify({ name, slug, kind: "postgres" }) },
  );
  return {
    producerId: body.producer.id,
    producerSlug: body.producer.slug,
    producerName: body.producer.name,
    webhookUrl: body.dbSetup.webhookUrl,
    setupSql: body.dbSetup.setupSql,
  };
}

export type ReclaimResult =
  | { kind: "api"; producerId: string; producerSlug: string; producerName: string; apiKey: string }
  | { kind: "postgres"; producerId: string; producerSlug: string; producerName: string; webhookUrl: string; setupSql: string };

/**
 * Reclaims an existing producer instead of creating a duplicate — the fix for registering
 * from a fresh checkout / different workspace, where bruce/.credentials.json (gitignored)
 * never existed locally even though the repo is already registered. What gets reclaimed
 * differs by kind: an api producer gets a fresh producer_key (single-active-key rotation,
 * same as agent_key — any workspace still holding the previous key starts seeing 401s from
 * `bruce publish` until it reclaims too); a postgres producer gets a fresh webhookSecret and
 * new setup SQL to paste in, since the previously-installed trigger's secret stops matching.
 */
export async function reclaimProducer(bruceApiUrl: string, agentKey: string, producerId: string): Promise<ReclaimResult> {
  const { body } = await request<{
    producer: { id: string; name: string; slug: string; kind: "api" | "postgres" };
    apiKey?: string;
    dbSetup?: { webhookUrl: string; setupSql: string };
  }>(`${bruceApiUrl}/api/producers/${producerId}/reclaim`, agentKey, { method: "POST" });

  const base = { producerId: body.producer.id, producerSlug: body.producer.slug, producerName: body.producer.name };
  if (body.producer.kind === "postgres") {
    return { kind: "postgres", ...base, webhookUrl: body.dbSetup!.webhookUrl, setupSql: body.dbSetup!.setupSql };
  }
  return { kind: "api", ...base, apiKey: body.apiKey! };
}

/**
 * Lists just {name, slug, kind} for every active producer under the agent key's owner — the
 * fix for cross-session consumer-linking, which previously had to guess a producer's slug
 * blind with no way to confirm or search. Deliberately minimal: no ids, status, or keys.
 */
export async function fetchProducerDirectory(
  bruceApiUrl: string,
  agentKey: string,
): Promise<{ name: string; slug: string; kind: "api" | "postgres" }[]> {
  const { body } = await request<{ producers: { name: string; slug: string; kind: "api" | "postgres" }[] }>(
    `${bruceApiUrl}/api/producers/directory`,
    agentKey,
  );
  return body.producers;
}

/**
 * Same-owner consumer auto-linking (DESIGN_NOTES.md §17): resolves a producer
 * by slug under the agent_key's own owner and mints a consumer relationship
 * against it in one call — the CLI never needs to know the producer's
 * numeric id, and this repo never sees any other producer's raw key, only
 * the consumer token minted for this specific relationship.
 */
export async function createConsumer(
  bruceApiUrl: string,
  agentKey: string,
  producerSlug: string,
  name: string,
  options?: { kind?: "api" | "database"; linkedProducerId?: string },
): Promise<{ token: string; bruceApiUrl: string; consumerId: string; producerSlug: string }> {
  const { body } = await request<{ consumer: { id: string }; token: string; bruceApiUrl: string; producerSlug: string }>(
    `${bruceApiUrl}/api/producers/by-slug/${producerSlug}/consumers`,
    agentKey,
    { method: "POST", body: JSON.stringify({ name, kind: options?.kind, linkedProducerId: options?.linkedProducerId }) },
  );
  return { token: body.token, bruceApiUrl: body.bruceApiUrl, consumerId: body.consumer.id, producerSlug: body.producerSlug };
}

/**
 * Auto-detected "this repo connects to its own database" edge (DESIGN_NOTES.md §19): called
 * from both `bruce init --agent-key` and `bruce producers connect-db` whenever the SAME repo
 * has sibling bruce/producer.json + bruce/db-producer.json manifests — the reliable signal that
 * one project registered itself as both an API producer and a database producer. Whichever
 * command runs second is the one that actually succeeds; a 409 (already linked, e.g. the other
 * command in the same parallel batch got there first) is expected and silently ignored — this
 * is a best-effort annotation on the graph, not a step anything else depends on.
 */
export async function linkDbConnection(
  bruceApiUrl: string,
  agentKey: string,
  dbProducerSlug: string,
  apiProducerName: string,
  apiProducerId: string,
): Promise<boolean> {
  try {
    await createConsumer(bruceApiUrl, agentKey, dbProducerSlug, apiProducerName, { kind: "database", linkedProducerId: apiProducerId });
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return false;
    throw err;
  }
}

export async function publishSnapshot(
  bruceApiUrl: string,
  producerKey: string,
  snapshot: PublisherSnapshot,
): Promise<{ published: boolean; changes: { summary: ChangeIntelligenceObject }[]; isFirstSnapshot: boolean }> {
  const { status, body } = await request<{ changes: { summary: ChangeIntelligenceObject }[]; isFirstSnapshot: boolean }>(
    `${bruceApiUrl}/api/snapshots`,
    producerKey,
    { method: "POST", body: JSON.stringify({ snapshot }) },
  );
  if (status === 204) return { published: false, changes: [], isFirstSnapshot: false };
  return { published: true, changes: body.changes, isFirstSnapshot: body.isFirstSnapshot };
}

export async function pushMapping(bruceApiUrl: string, consumerToken: string, consumerId: string, mapping: ConsumerMapping): Promise<boolean> {
  const { status } = await request(`${bruceApiUrl}/api/consumers/${consumerId}/mappings`, consumerToken, {
    method: "POST",
    body: JSON.stringify({ mapping }),
  });
  return status === 201;
}

export async function pull(
  bruceApiUrl: string,
  consumerToken: string,
  consumerId: string,
): Promise<{ unchanged: boolean; latestHash: string | null; changes: ChangeIntelligenceObject[]; changeIds?: string[] }> {
  const { body } = await request<{ unchanged: boolean; latestHash: string | null; changes: ChangeIntelligenceObject[]; changeIds?: string[] }>(
    `${bruceApiUrl}/api/consumers/${consumerId}/pull`,
    consumerToken,
  );
  return body;
}

export async function fetchDocs(bruceApiUrl: string, consumerToken: string, producerId: string): Promise<string> {
  const { body } = await request<{ markdown: string }>(`${bruceApiUrl}/api/producers/${producerId}/docs`, consumerToken);
  return body.markdown;
}

export async function ackChange(
  bruceApiUrl: string,
  consumerToken: string,
  consumerId: string,
  changeId: string,
): Promise<void> {
  await request(`${bruceApiUrl}/api/consumers/${consumerId}/pull/${changeId}/ack`, consumerToken, { method: "POST" });
}
