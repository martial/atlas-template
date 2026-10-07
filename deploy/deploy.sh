#!/usr/bin/env bash
# Run manually after reading docs/deployment.md. Creates a shared, public application.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ATLAS_GCP_PROJECT:?Set ATLAS_GCP_PROJECT to your Google Cloud project ID}"
ATLAS_REGION="${ATLAS_REGION:-europe-west1}"
ATLAS_SERVICE="${ATLAS_SERVICE:-atlas}"
ATLAS_BUCKET_NAME="${ATLAS_BUCKET_NAME:-${ATLAS_GCP_PROJECT}-atlas-files}"
ATLAS_VERTEX_LOCATION="${ATLAS_VERTEX_LOCATION:-global}"
ATLAS_SERVICE_ACCOUNT="${ATLAS_SERVICE}-runtime@${ATLAS_GCP_PROJECT}.iam.gserviceaccount.com"
ATLAS_IMAGE="${ATLAS_REGION}-docker.pkg.dev/${ATLAS_GCP_PROJECT}/atlas/app:latest"
ATLAS_JOB="${ATLAS_SERVICE}-index"
GCLOUD=(gcloud --project="$ATLAS_GCP_PROJECT" --quiet)
"${GCLOUD[@]}" services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  firestore.googleapis.com datastore.googleapis.com storage.googleapis.com aiplatform.googleapis.com

# Never convert an existing Native-mode database automatically.
if "${GCLOUD[@]}" firestore databases describe --database='(default)' > /dev/null 2>&1; then
  ATLAS_DB_TYPE=$("${GCLOUD[@]}" firestore databases describe --database='(default)' --format='value(type)')
  if [[ "$ATLAS_DB_TYPE" != "DATASTORE_MODE" ]]; then
    echo 'The default database is not in Datastore mode. Use a dedicated project with Datastore mode.' >&2
    exit 1
  fi
else
  "${GCLOUD[@]}" firestore databases create --database='(default)' --location="$ATLAS_REGION" --type=datastore-mode
fi
if ! "${GCLOUD[@]}" storage buckets describe "gs://$ATLAS_BUCKET_NAME" >/dev/null 2>&1; then
  "${GCLOUD[@]}" storage buckets create "gs://$ATLAS_BUCKET_NAME" --location="$ATLAS_REGION" --uniform-bucket-level-access --public-access-prevention
fi
if ! "${GCLOUD[@]}" iam service-accounts describe "$ATLAS_SERVICE_ACCOUNT" >/dev/null 2>&1; then
  "${GCLOUD[@]}" iam service-accounts create "${ATLAS_SERVICE}-runtime" --display-name='Atlas runtime'
fi
"${GCLOUD[@]}" projects add-iam-policy-binding "$ATLAS_GCP_PROJECT" --member="serviceAccount:$ATLAS_SERVICE_ACCOUNT" --role=roles/datastore.user --condition=None >/dev/null
"${GCLOUD[@]}" projects add-iam-policy-binding "$ATLAS_GCP_PROJECT" --member="serviceAccount:$ATLAS_SERVICE_ACCOUNT" --role=roles/aiplatform.user --condition=None >/dev/null
"${GCLOUD[@]}" storage buckets add-iam-policy-binding "gs://$ATLAS_BUCKET_NAME" --member="serviceAccount:$ATLAS_SERVICE_ACCOUNT" --role=roles/storage.objectUser >/dev/null
if ! "${GCLOUD[@]}" artifacts repositories describe atlas --location="$ATLAS_REGION" >/dev/null 2>&1; then
  "${GCLOUD[@]}" artifacts repositories create atlas --repository-format=docker --location="$ATLAS_REGION"
fi
"${GCLOUD[@]}" builds submit --tag="$ATLAS_IMAGE" .
ATLAS_ENV="ATLAS_PROJECT=$ATLAS_GCP_PROJECT,ATLAS_VERTEX_PROJECT=$ATLAS_GCP_PROJECT,ATLAS_VERTEX_LOCATION=$ATLAS_VERTEX_LOCATION,ATLAS_STORAGE=gcs,ATLAS_BUCKET=$ATLAS_BUCKET_NAME,ATLAS_PROVIDER=vertex,ATLAS_JOBS=cloud-run,ATLAS_JOB_NAME=projects/$ATLAS_GCP_PROJECT/locations/$ATLAS_REGION/jobs/$ATLAS_JOB"
"${GCLOUD[@]}" run jobs deploy "$ATLAS_JOB" --image="$ATLAS_IMAGE" --region="$ATLAS_REGION" \
  --service-account="$ATLAS_SERVICE_ACCOUNT" --command=python --args=-m,atlas.worker \
  --set-env-vars="$ATLAS_ENV" \
  --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=3600s --cpu=2 --memory=4Gi
"${GCLOUD[@]}" run jobs add-iam-policy-binding "$ATLAS_JOB" --region="$ATLAS_REGION" \
  --member="serviceAccount:$ATLAS_SERVICE_ACCOUNT" --role=roles/run.jobsExecutorWithOverrides >/dev/null
# Two revisions: first determine the service URL, then set the exact browser/MCP origin.
"${GCLOUD[@]}" run deploy "$ATLAS_SERVICE" --image="$ATLAS_IMAGE" --region="$ATLAS_REGION" \
  --service-account="$ATLAS_SERVICE_ACCOUNT" --set-env-vars="$ATLAS_ENV" \
  --no-allow-unauthenticated \
  --min-instances=0 --max-instances=2 --concurrency=16 --cpu=1 --memory=2Gi --timeout=900s
ATLAS_URL=$("${GCLOUD[@]}" run services describe "$ATLAS_SERVICE" --region="$ATLAS_REGION" --format='value(status.url)')
"${GCLOUD[@]}" run services update "$ATLAS_SERVICE" --region="$ATLAS_REGION" --update-env-vars="ATLAS_PUBLIC_URL=$ATLAS_URL"
"${GCLOUD[@]}" run jobs update "$ATLAS_JOB" --region="$ATLAS_REGION" --update-env-vars="ATLAS_PUBLIC_URL=$ATLAS_URL"
ATLAS_CORS_FILE=$(mktemp)
trap 'rm -f "$ATLAS_CORS_FILE"' EXIT
# Values come from gcloud and are quoted as JSON by Python.
python3 - "$ATLAS_URL" "$ATLAS_CORS_FILE" <<'PY'
import json, sys
with open(sys.argv[2], 'w') as file:
    json.dump([{'origin':[sys.argv[1]], 'method':['PUT','GET','HEAD'],
                'responseHeader':['Content-Type','Content-Range','Range'], 'maxAgeSeconds':3600}], file)
PY
"${GCLOUD[@]}" storage buckets update "gs://$ATLAS_BUCKET_NAME" --cors-file="$ATLAS_CORS_FILE"
"${GCLOUD[@]}" run services add-iam-policy-binding "$ATLAS_SERVICE" --region="$ATLAS_REGION" --member=allUsers --role=roles/run.invoker >/dev/null
printf 'Atlas is available at %s\nMCP: %s/mcp/\n' "$ATLAS_URL" "$ATLAS_URL"
