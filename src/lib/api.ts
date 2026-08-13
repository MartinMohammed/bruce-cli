import type { ChangeIntelligenceObject, ConsumerMapping, PublisherSnapshot } from "../shared/index.js";

async function request<T>(url: string, token: string, options: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options.headers },
  });
  const body = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  if (!response.ok) {
    throw new Error(`${response.status} ${url}: ${JSON.stringify(body)}`);
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
