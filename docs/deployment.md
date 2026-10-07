# Google Cloud deployment

Cloud Run is the default hosting target. App Engine is not used. Run the deployment script manually from your own terminal after reviewing it; creating this repository does not deploy it.

## Shared access

There is no application sign-in or OAuth. The script's final step makes the Cloud Run service public. Anyone who can reach its URL can read, upload, replace, delete, index, and ask questions in the shared workspace. MCP exposes read-only tools, while the web API supports writes. Use this configuration only for data and usage you intend to share with those visitors. A public source repository does not require a public running instance; you can keep the deployment behind network/IAM controls if needed.

## Prerequisites

- A dedicated Google Cloud project with billing enabled and sufficient quota.
- Google Cloud CLI authenticated as an operator able to create the listed resources and grant IAM roles.
- A **Datastore-mode** default database, or an empty project. The script refuses to convert an existing Native-mode database.
- Access to Gemini models through Vertex AI. The deployed service and indexing job use the attached runtime service account through Application Default Credentials; no API key, Secret Manager secret, or service-account JSON key is needed.
- Cloud Build's build identity needs permission to build images and write to Artifact Registry in your project. Organization policies can require additional setup.

## Deploy

```sh
export ATLAS_GCP_PROJECT=your-project-id
export ATLAS_REGION=europe-west1
./deploy/deploy.sh
```

Optional shell variables: `ATLAS_SERVICE`, `ATLAS_BUCKET_NAME`, `ATLAS_VERTEX_LOCATION` (default `global`). The Vertex AI model location is separate from `ATLAS_REGION`, which controls Cloud Run and storage.

The script enables APIs, creates or verifies the Datastore-mode database, creates a private bucket and runtime service account, builds the image, deploys the indexing job and service, configures their public URL and GCS CORS origin, and grants public invocation on the service. It enables the Vertex AI API and attaches the runtime service account to both workloads.

The runtime account receives Datastore user access, object access on its bucket, Vertex AI User access (`roles/aiplatform.user`), and job-executor-with-overrides permission on the indexing job. Sources and vectors remain in the private bucket; the application controls preview access and source-revision checks.

Cloud Run Jobs use one task per update, two CPUs and 4 GiB memory. The web service defaults to at most two instances, 1 CPU, and 2 GiB. Edit these and the usage limits for your collection size. Indexing is dispatched to Jobs, so it does not rely on an idle web instance continuing background work.

## Local Vertex AI authentication

Use `gcloud auth application-default login` for the backend SDK. `gcloud auth login` by itself only signs in the CLI. Select the model project with `gcloud config set project YOUR_PROJECT_ID` and set the ADC quota project with `gcloud auth application-default set-quota-project YOUR_PROJECT_ID`.

The model client explicitly requests ADC and initializes `genai.Client(vertexai=True, project=..., location=..., credentials=...)`. An ambient SDK API-key variable cannot switch this client to key authentication. In Cloud Run the same code discovers the attached service account through metadata; no interactive login runs there.

Use `ATLAS_VERTEX_PROJECT` to override project discovery, and `ATLAS_VERTEX_LOCATION` to select a supported model location. Model defaults are `gemini-embedding-2` for embeddings and `gemini-3.5-flash-lite` for descriptions and Ask. Validate availability for your chosen location. The default `global` endpoint does not promise regional data residency.

## Container locally

```sh
docker build -t atlas-template .
docker run --rm -p 8080:8080 \
  -e DATASTORE_EMULATOR_HOST=host.docker.internal:8791 \
  -e ATLAS_PROJECT=atlas-local \
  -e ATLAS_PROVIDER=offline \
  -e ATLAS_PUBLIC_URL=http://localhost:8080 \
  -v atlas-objects:/app/.local \
  atlas-template
```

On Linux, add the appropriate host-gateway mapping or run an emulator in the same Docker network. The Datastore emulator must be reachable from the container. The container uses a non-root user, and `ffmpeg` is included.

## Operational notes

The request/AI/upload counters are shared in Datastore across instances. These are template guardrails, not a complete abuse-prevention or billing system. Monitor provider spend separately. Set `ATLAS_DAILY_AI_CALLS`, `ATLAS_REQUESTS_PER_MINUTE`, `ATLAS_UPLOAD_SESSIONS_PER_DAY`, and file/chunk limits to appropriate values before broad public access.

Model names are configurable. After changing embedding model, dimensions, provider, or preprocessing, run Update index. Querying an incompatible snapshot returns a clear error until it is rebuilt. The code uses Embedding 2 prompt prefixes rather than the older embedding API's task-type parameter.

No-op updates make no model calls. Errors preserve valid sources; retries reuse cached finished segments. Jobs whose worker lease expires become retryable. Cloud Run job retries are disabled in the supplied script to avoid ambiguous duplicate execution; use the UI to start a deliberate retry.

The bucket retains old private revisions and cached artifacts. Add backup, object-retention and garbage-collection policies suitable for your use. The template does not automatically empty buckets or delete a Google Cloud project.

The deployment script has to be tested against your project, permissions, organization policies, model access, and billing configuration. Local emulator tests do not establish that a production project is ready.
