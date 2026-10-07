export type FileKind = "image" | "video" | "audio" | "document";
export type FileStatus = "indexed" | "pending" | "error";
export interface Asset {
  id: string;
  collection: string;
  name: string;
  kind: FileKind;
  mime: string;
  size: number;
  detail: string;
  description: string;
  tags: string[];
  group: number;
  chunks: number;
  status: FileStatus;
  image?: string;
  url?: string;
  text?: string;
  created: string;
  revision?: number;
  error?: string;
}
export interface Collection {
  active_job?: string | null;
  snapshot?: string | null;
  id: string;
  name: string;
  description: string;
}
export interface Point {
  id: string;
  asset: string;
  x: number;
  y: number;
  z?: number;
  group: number;
  part: number;
}
export interface Turn {
  id: string;
  question: string;
  answer: string;
  sources: string[];
  citations?: Citation[];
  provider?: string;
}
export interface Workspace {
  collections: Collection[];
  assets: Asset[];
  conversations: Record<string, Turn[]>;
}
export interface Citation {
  chunk: string;
  asset: string;
  name: string;
  text: string;
  score: number;
  location: {
    page?: number;
    start?: number;
    end?: number;
    offset?: number;
    modality?: string;
  };
  preview?: string;
  url: string;
  revision: number;
}
export interface MapSnapshot {
  version: string | null;
  points: Point[];
  edges: [string, string][];
  method: string;
  provider: string;
}
export interface Job {
  id: string;
  collection: string;
  state: "queued" | "running" | "completed" | "failed";
  completed: number;
  total: number;
  message: string;
  errors: { asset: string; name: string; message: string }[];
}
export interface AppConfig {
  provider: "vertex" | "offline";
  configuration_error?: string | null;
  authentication: "adc" | "none";
  configured: boolean;
  database: string;
  storage: string;
  jobs: string;
  max_upload_mb: number;
  mcp_url: string;
}
