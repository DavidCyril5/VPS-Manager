#!/bin/bash

set -e

REPO_URL="https://DavidCyril5:${GITHUB_TOKEN}@github.com/DavidCyril5/VPS-Manager.git"
REMOTE_NAME="backup"
BRANCH="main"
SYNC_INTERVAL=60

if [ -z "$GITHUB_TOKEN" ]; then
  echo "[sync] ERROR: GITHUB_TOKEN secret is not set. Exiting."
  exit 1
fi

git config user.email "sync-bot@replit.com" 2>/dev/null || true
git config user.name "Replit Sync Bot" 2>/dev/null || true

if git remote get-url "$REMOTE_NAME" &>/dev/null; then
  git remote set-url "$REMOTE_NAME" "$REPO_URL"
else
  git remote add "$REMOTE_NAME" "$REPO_URL"
fi

echo "[sync] Auto-sync started. Pushing to github.com/DavidCyril5/VPS-Manager every ${SYNC_INTERVAL}s."

do_sync() {
  if ! git diff --quiet || ! git diff --staged --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    git add -A
    git commit -m "auto-sync: ${TIMESTAMP}" --allow-empty-message 2>/dev/null || true
    echo "[sync] Changes committed at ${TIMESTAMP}"
  fi

  if git push "$REMOTE_NAME" HEAD:"$BRANCH" --force 2>&1; then
    echo "[sync] Pushed to backup repo successfully at $(date '+%H:%M:%S')"
  else
    echo "[sync] Push failed at $(date '+%H:%M:%S') — will retry next cycle"
  fi
}

do_sync

while true; do
  sleep "$SYNC_INTERVAL"
  do_sync
done
