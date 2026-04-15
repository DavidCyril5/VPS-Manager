# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: MongoDB Atlas via Mongoose (connection string in `MONGODB_URI` env var)
- **Validation**: Zod (`zod/v4`)
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## VPS Website Manager

A full-featured VPS control panel that lets you:
- Add and manage VPS servers via SSH
- Deploy websites from Git repos (with access tokens)
- Install and configure Nginx automatically
- Set up SSL certificates via Let's Encrypt (certbot)
- Manage Cloudflare DNS and proxy settings
- View deployment activity logs

### Artifact: vps-manager (React + Vite, previewPath: /)

Pages:
- `/` — Dashboard with stats and recent activity
- `/servers` — List/add/remove VPS servers, test SSH, install Nginx
- `/servers/:id` — Server detail: stats (CPU/memory/disk), actions
- `/sites` — List/create/deploy/delete websites; Nginx config editor, SSL expiry badge, webhook URL
- `/terminal` — Live SSH terminal (xterm.js + WebSocket)
- `/cloudflare` — Add Cloudflare accounts, create DNS A records
- `/activity` — Deployment activity log

### API Server (Express 5, previewPath: /api)

Routes:
- `GET/POST /api/servers` — List/create servers
- `GET/PATCH/DELETE /api/servers/:id` — Server CRUD
- `POST /api/servers/:id/test-connection` — SSH connection test
- `POST /api/servers/:id/install-nginx` — Install nginx/certbot via SSH
- `GET /api/servers/:id/stats` — CPU/memory/disk via SSH
- `GET/POST /api/sites` — List/create sites
- `GET/PATCH/DELETE /api/sites/:id` — Site CRUD
- `POST /api/sites/:id/deploy` — Clone repo, configure Nginx
- `POST /api/sites/:id/ssl` — Install SSL via certbot
- `GET/POST /api/cloudflare` — Cloudflare configs
- `DELETE /api/cloudflare/:id` — Remove config
- `GET /api/cloudflare/:id/zones` — List CF zones
- `POST /api/cloudflare/:id/create-dns` — Create A record
- `GET /api/activity` — Activity log
- `GET /api/dashboard/summary` — Stats summary
- `GET/PUT /api/sites/:id/nginx-config` — Read/write nginx config via SSH
- `GET /api/sites/:id/ssl-status` — Live SSL expiry check via certbot
- `POST /api/webhook/:token` — Auto-deploy trigger (public, no auth)
- `WS /api/terminal?serverId=N` — WebSocket SSH shell (xterm.js)

### MongoDB Collections (via Mongoose)

- `servers` — SSH connection info, status, nginx flag; integer `id` via counter
- `sites` — Domain, repo, deploy path, type, status, webhook token, ssl expiry
- `cloudflareconfigs` — CF API tokens
- `activity` — Deployment event log
- `counters` — Auto-increment ID sequences

### SSH Library

Uses `ssh2` package for SSH connections. Credentials stored in DB and used per-request.
Native crypto module optional (falls back to pure JS).
