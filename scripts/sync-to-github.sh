#!/bin/bash

set -e
REPO_URL="https://DavidCyril5:${GITHUB_TOKEN}@github.com/DavidCyril5/VPS-Manager.git"
BRANCH="main"
SYNC_INTERVAL=60
WORKSPACE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMP_DIR="/tmp/vps-sync-repo"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "[sync] ERROR: GITHUB_TOKEN secret is not set. Exiting."
  exit 1
fi

echo "[sync] Auto-sync started. Pushing to github.com/DavidCyril5/VPS-Manager every ${SYNC_INTERVAL}s."

do_sync() {
  TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

  rm -rf "$TEMP_DIR"
  mkdir -p "$TEMP_DIR"

  cd "$WORKSPACE_DIR"
  tar --exclude='./.git' --exclude='./node_modules' --exclude='./.local' \
    --exclude='./.replit' --exclude='./.env' --exclude='./replit.nix' \
    -cf - . | tar -xf - -C "$TEMP_DIR"

  cd "$TEMP_DIR"
  git init -q
  git config user.email "sync-bot@replit.com"
  git config user.name "Replit Sync Bot"
  git checkout -q -b "$BRANCH"
  git add -A
  git commit -q -m "auto-sync: ${TIMESTAMP}" --allow-empty

  if git push "$REPO_URL" "$BRANCH" --force -q 2>&1; then
    echo "[sync] Pushed to backup repo successfully at $(date '+%H:%M:%S')"
  else
    echo "[sync] Push failed at $(date '+%H:%M:%S') — will retry next cycle"
  fi

  cd "$WORKSPACE_DIR"
  rm -rf "$TEMP_DIR"
}

do_sync

while true; do
  sleep "$SYNC_INTERVAL"
  do_sync
done
