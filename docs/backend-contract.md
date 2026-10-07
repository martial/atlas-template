# Architecture and HTTP API

## Data flow

1. The browser reserves an upload through the API. Locally it streams bytes to the server; on Google Cloud it PUTs to a scoped GCS resumable session.
2. Completion verifies byte count, media type, and content hash. The asset receives a stable ID and source revision. A replacement with identical content retains its existing index.
3. An indexing request acquires a collection lease and creates a durable job. A local thread or a Cloud Run Job claims it. A heartbeat renews the lease; concurrent update requests return the existing job.
4. The worker splits source material into bounded passages/pages/time ranges, normalizes media, creates native embeddings and descriptions, and caches each completed segment.
5. Vectors are normalized and projected with seeded UMAP, or PCA for fewer than six distinct vectors. Both map dimensions share one coordinate system. Native and description vectors each have a projection.
6. The worker writes metadata JSON and compressed float32 NPZ objects, then atomically changes the collection's active snapshot reference. Readers filter every snapshot against current asset revisions/tombstones, including cached snapshots.
7. Search embeds the query and ranks valid vectors by dot product. Ask plans either a targeted search (up to three queries and eight passages) or an overview using descriptions/passages across the collection. Overview sources are naturally sorted by filename and within-file position. All are included when they fit 512 passages and 128,000 serialized source characters; otherwise coverage is spread across files and positions, and marked as limited. Up to four preview images accompany either mode. Answers cite supplied evidence; only cited sources are returned, with references renumbered to match the source cards.

## Storage

The catalogue uses `google-cloud-datastore`. Kinds: Collection, Asset, Upload, IndexJob, IndexSnapshot, Usage. Large entity payloads are unindexed JSON; collection references use a normal equality index. No User or OAuth kinds exist. Chunks and vectors live in object storage, referenced by each asset and snapshot. Vertex AI uses Application Default Credentials on the server: gcloud ADC locally and an attached Cloud Run service account in deployment. No API-key authentication path exists.

Cache identity includes source SHA-256, preprocessing version, provider, embedding model, answer/description model, and dimensions. Each map response has one snapshot version. Replacing/deleting an asset invalidates its old references immediately, before reindexing.

Failed files get actionable errors. Valid files remain available, and snapshots publish only after the new objects are fully stored. Retry through Update index; finished segment caches are reused. Long jobs run outside request lifetime on Cloud Run. A stale worker cannot publish after a newer job acquires the collection lease.

## Media

- Images: EXIF orientation, bounded JPEG normalization, thumbnail.
- Text/Markdown: UTF-8 validation and overlapping 12,000-character passages.
- PDFs: one page per native embedding; text-dense pages split into text passages to avoid silent truncation. Encrypted PDFs are rejected.
- Video: overlapping 20-second visual-only MP4 segments; separate MP3 segments for the sound track; preview frames.
- Audio: overlapping 90-second mono MP3 segments.

Source locations preserve page, character offset, or start/end time. ffmpeg receives argument arrays, local file protocols, and a timeout. Parsing and model calls have explicit size/chunk limits.

## Routes

All API routes are below `/api/v1`.

| Route | Purpose |
| --- | --- |
| `GET /config` | Safe runtime status and client limits; never secrets |
| `GET/POST /collections` | List/create collections |
| `GET/PATCH /collections/{id}` | Read/edit metadata |
| `GET /collections/{id}/assets` | Current file metadata/status |
| `POST /collections/{id}/uploads` | Reserve upload: name, size, optional replacement ID |
| `PUT /uploads/{id}/bytes` | Local object upload; hosted clients use the returned GCS URL |
| `POST /uploads/{id}/complete` | Validate and register source revision |
| `GET/DELETE /assets/{id}` | Metadata/text excerpt or tombstone |
| `GET/HEAD /assets/{id}/preview` | Original source with byte-range support |
| `GET /assets/{id}/thumbnail` | Image/poster thumbnail |
| `GET /assets/{id}/similar` | Neighboring indexed chunks in other files |
| `GET /collections/{id}/estimate` | Pending files/bytes and conservative model-call ceiling |
| `POST /collections/{id}/index` | Idempotent dispatch of an update job |
| `GET /jobs/{id}` | Durable progress and per-file errors |
| `GET /collections/{id}/map?lens=content` | Versioned 2D/3D coordinates and edges; `text` lens also supported |
| `POST /collections/{id}/search` | Query, limit, optional kind → ranked source passages |
| `POST /collections/{id}/search-image` | Multipart query image → ranked passages |
| `POST /collections/{id}/ask` | Question and up to eight prior turns → answer, citations, and retrieval coverage |

FastAPI's schema is available at `/docs` and `/openapi.json`. `/healthz` is a lightweight process health check.

## MCP

Streamable HTTP at `/mcp/`; `python -m atlas.mcp_server` provides stdio. The read-only tools call the same service methods as HTTP. `get_item(include_image=true)` returns an inline image when a thumbnail exists. Search/related results include stable asset/chunk IDs, source location, score, text, and a preview URL. MCP clients decide how to display image content and links; Atlas does not assume that every client renders every media type.

Ask calls shared retrieval directly and sends the retrieved evidence to Gemini on Vertex AI. An external Gemini-compatible agent can instead discover the MCP tools and orchestrate its own retrieval. MCP is a tool transport, not a separate embedding store.

## References

- [Vertex AI multimodal embeddings and modality limits](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings)
- [Google Cloud ADC setup](https://docs.cloud.google.com/docs/authentication/provide-credentials-adc)
- [Vertex AI model lifecycle](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions)
- [Datastore-mode emulator](https://docs.cloud.google.com/datastore/docs/emulator)
- [Cloud Storage resumable sessions](https://docs.cloud.google.com/python/docs/reference/storage/latest/google.cloud.storage.blob.Blob)
- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk/tree/v1.x)
