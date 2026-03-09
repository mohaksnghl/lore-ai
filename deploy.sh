#!/usr/bin/env bash
# deploy.sh — Manual one-shot deploy to Cloud Run.
# Usage: ./deploy.sh
#
# Requires: gcloud CLI authenticated, PROJECT_ID + REGION set below.
# For automated deploys on push, see cloudbuild.yaml.

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project)}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="lore-server"
ARTIFACT_REPO="lore-repo"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}/${SERVICE_NAME}"

echo "▶ Deploying Lore to Cloud Run"
echo "  Project : ${PROJECT_ID}"
echo "  Region  : ${REGION}"
echo "  Image   : ${IMAGE}:latest"
echo ""

# ── Build & push ─────────────────────────────────────────────────────────────
echo "▶ Building Docker image..."
# Root context — multi-stage Dockerfile builds React client + Python server
gcloud builds submit . \
  --tag "${IMAGE}:latest" \
  --project "${PROJECT_ID}"

# ── Deploy ───────────────────────────────────────────────────────────────────
echo "▶ Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}:latest" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --session-affinity \
  --timeout 300 \
  --min-instances 1 \
  --max-instances 10 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
  --project "${PROJECT_ID}"

echo ""
echo "✅ Deployed! Service URL:"
gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --format "value(status.url)"
