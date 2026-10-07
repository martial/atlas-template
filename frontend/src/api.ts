import type {
  Asset,
  Collection,
  MapSnapshot,
  Citation,
  Job,
  AppConfig,
} from "./types";

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: `Server returned ${response.status}` }));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : "The request was not valid.",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const api = {
  config: () => request<AppConfig>("/config"),
  collections: () => request<Collection[]>("/collections"),
  assets: (id: string) => request<Asset[]>(`/collections/${id}/assets`),
  asset: (id: string) => request<Asset>(`/assets/${id}`),
  createCollection: (name: string, description: string) =>
    request<Collection>("/collections", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  remove: (id: string) => request<void>(`/assets/${id}`, { method: "DELETE" }),
  map: (id: string, lens: string) =>
    request<MapSnapshot>(`/collections/${id}/map?lens=${lens}`),
  search: (id: string, query: string, signal?: AbortSignal) =>
    request<Citation[]>(`/collections/${id}/search`, {
      method: "POST",
      body: JSON.stringify({ query, limit: 30 }),
      signal,
    }),
  similar: (id: string) => request<Citation[]>(`/assets/${id}/similar`),
  ask: (
    id: string,
    question: string,
    history: { question: string; answer: string }[],
  ) =>
    request<{ answer: string; citations: Citation[]; provider: string }>(
      `/collections/${id}/ask`,
      {
        method: "POST",
        body: JSON.stringify({ question, history: history.slice(-8) }),
      },
    ),
  estimate: (id: string) =>
    request<{
      files: number;
      unchanged: number;
      bytes: number;
      max_ai_calls: number;
      note: string;
    }>(`/collections/${id}/estimate`),
  index: (id: string) =>
    request<Job>(`/collections/${id}/index`, { method: "POST" }),
  job: (id: string) => request<Job>(`/jobs/${id}`),
  async upload(
    collection: string,
    file: File,
    replace?: string,
  ): Promise<Asset> {
    const upload = await request<{ id: string; url: string; mime: string }>(
      `/collections/${collection}/uploads`,
      {
        method: "POST",
        body: JSON.stringify({ name: file.name, size: file.size, replace }),
      },
    );
    const response = await fetch(upload.url, {
      method: "PUT",
      headers: { "Content-Type": upload.mime },
      body: file,
    });
    if (!response.ok)
      throw new Error(`Upload failed (${response.status}). Try again.`);
    return request<Asset>(`/uploads/${upload.id}/complete`, { method: "POST" });
  },
};
