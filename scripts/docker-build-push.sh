#!/usr/bin/env bash
# Build + push oc-controller images.
# Set OC_CONTROLLER_REGISTRY (default: oc-controller) and optional OC_CONTROLLER_IMAGE_TAG.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICES="$(cd "$ROOT/.." && pwd)"
REGISTRY="${OC_CONTROLLER_REGISTRY:-oc-controller}"
TAG="${OC_CONTROLLER_IMAGE_TAG:-latest}"

log() { printf '[oc-controller-images] %s\n' "$*"; }

log "Building backend…"
docker build \
  -t "${REGISTRY}/oc-controller-backend:${TAG}" \
  "$ROOT/backend"

log "Building frontend (context: services/)…"
docker build \
  -f "$ROOT/frontend/Dockerfile" \
  -t "${REGISTRY}/oc-controller-frontend:${TAG}" \
  "$SERVICES"

if [[ "${OC_CONTROLLER_SKIP_PUSH:-}" == "true" ]]; then
  log "Skip push (OC_CONTROLLER_SKIP_PUSH=true)"
  exit 0
fi

log "Pushing…"
docker push "${REGISTRY}/oc-controller-backend:${TAG}"
docker push "${REGISTRY}/oc-controller-frontend:${TAG}"
log "Done: ${REGISTRY}/oc-controller-{backend,frontend}:${TAG}"
