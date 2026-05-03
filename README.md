# VPS Deploy Hub

A self-hosted web control panel for managing VPS servers, deploying websites from Git repositories, configuring Nginx, installing SSL certificates, and managing Cloudflare DNS — all from a clean dark-themed dashboard.

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Getting Started](#getting-started)
4. [Step 1 — Adding a Server](#step-1--adding-a-server)
5. [Step 2 — Server Detail & Stats](#step-2--server-detail--stats)
6. [Step 3 — Saving Git Tokens](#step-3--saving-git-tokens)
7. [Step 4 — Creating a Site](#step-4--creating-a-site)
8. [Step 5 — Deploying a Site](#step-5--deploying-a-site)
9. [Step 6 — SSL Certificates](#step-6--ssl-certificates)
10. [Step 7 — Nginx Config Viewer & Editor](#step-7--nginx-config-viewer--editor)
11. [Step 8 — Auto-Deploy via Webhook](#step-8--auto-deploy-via-webhook)
12. [Step 9 — Cloudflare DNS Management](#step-9--cloudflare-dns-management)
13. [Step 10 — SSH Terminal](#step-10--ssh-terminal)
14. [Step 11 — Activity Logs](#step-11--activity-logs)
15. [Field Reference](#field-reference)
16. [Build Command Examples](#build-command-examples)
17. [Serve From Examples](#serve-from-examples)
18. [Troubleshooting](#troubleshooting)

---

## Overview

VPS Deploy Hub connects to your VPS servers over SSH and lets you:

- Deploy any website or web app directly from a GitHub, GitLab, or Bitbucket repository
- Automatically detect and use `npm`, `pnpm`, or `yarn` based on your lock file
- Configure Nginx virtual hosts automatically on each deploy
- Install Let's Encrypt SSL certificates with one click
- Point domains to your server via Cloudflare DNS
- Open a live SSH terminal session in your browser
- Track every deploy, SSL install, and DNS change in the Activity Log

---

## Features

| Feature | Description |
|---|---|
| Multi-server support | Add and manage as many VPS servers as you like |
| Git deploy | Clone and pull from any public or private repo |
| Smart Node.js build | Auto-detects pnpm / yarn / npm from lock files |
| Nginx auto-config | Writes and reloads the virtual host on every deploy |
| SSL (Let's Encrypt) | One-click Certbot install + auto-renewal tracking |
| Serve From | Point nginx to any subfolder (e.g. `dist`, `out`) |
| Webhook auto-deploy | GitHub/GitLab webhook triggers instant redeploy |
| Repo browser | Browse and select private repos using saved tokens |
| Cloudflare DNS | Create DNS A records from inside the dashboard |
| SSH terminal | Full interactive terminal in the browser (xterm.js) |
| Activity log | Filterable log of every action with full output |
| Dashboard stats | Live count of servers, sites, active sites, SSL certs |

---

## Getting Started

### Requirements on your VPS

- Ubuntu / Debian (recommended)
- SSH access as `root` (or a sudo user)
- Port 22 open
- Nginx installed (or use the one-click installer inside the app)
- Certbot installed for SSL (optional, installed on demand)

### Running VPS Deploy Hub

```bash
git clone https://github.com/your-username/vps-deploy-hub.git
cd vps-deploy-hub
pnpm install
pnpm run dev
```

The app runs on the port defined in the `PORT` environment variable (default: the Replit-assigned port). Open it in your browser to get started.

---

## Step 1 — Adding a Server

Go to **Servers** in the left sidebar and click **Add Server**.

| Field | What to enter |
|---|---|
| Name | A friendly label, e.g. `My VPS` |
| Host / IP | The public IP address or hostname of your server |
| Port | SSH port — usually `22` |
| Username | SSH username — usually `root` |
| Password | SSH password **or** leave blank if using a key |
| Private Key | Paste your SSH private key (PEM format) if using key auth |

Click **Add Server**. The app will immediately try to connect and show a green status badge if successful.

> **Tip:** If your server uses key-based auth, paste the contents of your `~/.ssh/id_rsa` file into the Private Key field.

---

## Step 2 — Server Detail & Stats

Click the server name to open its detail page. Here you can:

- **View live resource stats** — CPU usage, RAM, and disk shown as progress bars (red = above 80%)
- **Test connection** — re-verify SSH access at any time
- **Install Nginx** — if Nginx is not already installed, this will SSH in and run `apt install nginx` for you

Click **Refresh** to pull the latest stats from the server.

---

## Step 3 — Saving Git Tokens

If you want to deploy from **private repositories**, save your access token first.

1. Go to **Sites** → click **Manage Tokens** (top-right area)
2. Click **Save New Token**
3. Enter a label (e.g. `GitHub Personal`), choose the host (`github.com`, `gitlab.com`, etc.), and paste your token
4. Click **Save**

Your token is stored encrypted in the database. When creating or editing a site, you can select it from a dropdown instead of pasting it every time.

> **How to get a GitHub token:**
> GitHub → Settings → Developer Settings → Personal Access Tokens → Tokens (classic) → Generate new token → tick `repo` scope → copy the token.

---

## Step 4 — Creating a Site

Go to **Sites** and click **+ New Site**.

### Required fields

| Field | Description |
|---|---|
| **Site Name** | A label for the site, e.g. `My Blog` |
| **Domain** | The domain or subdomain to serve, e.g. `blog.example.com` |
| **Server** | Select which of your VPS servers to deploy to |
| **Deploy Path** | Absolute path on the server where the repo will be cloned, e.g. `/var/www/my-blog` |
| **Site Type** | `Static`, `Node.js`, `PHP`, or `Python` |

### Optional fields

| Field | Description |
|---|---|
| **Serve From** | Subfolder inside the deploy path that nginx should serve (see [Serve From Examples](#serve-from-examples)) |
| **Repo URL** | Git clone URL, e.g. `https://github.com/user/repo` |
| **Git Token** | Select a saved token, or paste one in the token field |
| **Build Command** | Command to run after cloning/pulling (see [Build Command Examples](#build-command-examples)) |
| **Auto-sync** | Enable webhook auto-deploy (see [Step 8](#step-8--auto-deploy-via-webhook)) |

Click **Create Site**. This saves the configuration but does **not** deploy yet.

---

## Step 5 — Deploying a Site

After creating a site, click the **rocket icon** (Deploy) on the site card.

What happens during a deploy:

1. SSHs into the server
2. If a repo URL is set:
   - First deploy: clones the repo into the deploy path
   - Re-deploys: runs `git pull` to fetch the latest code
3. If a build command is set: runs it in the deploy path
4. Writes an Nginx virtual host config for the domain
5. Tests and reloads Nginx
6. If a Cloudflare account is linked: creates a DNS A record pointing to the server

A log modal shows the full terminal output. The site status turns **green (active)** on success or **red (failed)** on error.

> **Re-deploy at any time** by clicking the rocket icon again. Use this after pushing new code to your repo.

### Editing a site

Click the **pencil icon** on the site card to expand the edit form. Change any field and click:
- **Save & Redeploy** — saves settings and immediately runs a new deploy
- **Save Only** — saves settings without deploying

---

## Step 6 — SSL Certificates

SSL is installed using [Certbot](https://certbot.eff.org/) + Let's Encrypt.

**Before installing SSL:**
- Your domain must already be pointing to the server (DNS propagated)
- Nginx must be running and serving the domain on port 80
- Certbot must be installed on the server (`apt install certbot python3-certbot-nginx`)

Click the **shield icon** (Install SSL / Renew SSL) on any site card.

The app will:
1. SSH into the server
2. Run `certbot --nginx -d yourdomain.com --non-interactive --agree-tos -m admin@yourdomain.com`
3. Record the expiry date and show a countdown badge on the site card

**SSL expiry badge colours:**
- Green — more than 30 days remaining
- Amber — 14–30 days remaining
- Red — fewer than 14 days (renew now)

Click **Renew SSL** (same button) at any time to force a renewal.

---

## Step 7 — Nginx Config Viewer & Editor

Click the **file icon** on any site card to open the Nginx Config panel.

You can:
- **View** the current virtual host config on the server (fetched live over SSH)
- **Edit** the config directly in the browser
- **Save & Reload** — writes the updated config to the server and reloads Nginx

> This is useful for adding custom headers, proxy rules, caching, redirects, etc. without SSHing in manually.

---

## Step 8 — Auto-Deploy via Webhook

Enable **Auto-sync** on a site to get a unique webhook URL. Every time you push to your repo, GitHub/GitLab will call this URL and trigger an automatic deploy.

### Setting up the webhook

1. Edit the site and tick **Enable auto-sync**, then save
2. Click the **link icon** on the site card to reveal the webhook URL
3. Copy the URL
4. In GitHub: go to your repo → Settings → Webhooks → Add webhook
   - Payload URL: paste the webhook URL
   - Content type: `application/json`
   - Event: **Just the push event**
   - Click **Add webhook**

Every push to your repo will now automatically pull the latest code and rebuild the site.

---

## Step 9 — Cloudflare DNS Management

Go to **Cloudflare** in the sidebar and click **Add Account**.

| Field | What to enter |
|---|---|
| Label | A friendly name, e.g. `My Cloudflare` |
| Email | Your Cloudflare account email |
| API Token | A Cloudflare API token with DNS edit permissions |
| Zone ID | Optional default zone — you can also select it per-record |

> **How to create a Cloudflare API Token:**
> Cloudflare Dashboard → My Profile → API Tokens → Create Token → use the **Edit zone DNS** template → select your domain → Create Token.

### Creating a DNS A Record

1. Expand a Cloudflare account card
2. Click **Manage DNS Records**
3. Your zones (domains) load automatically — click **Use** next to the one you want
4. The Zone ID and domain auto-fill
5. Enter the server IP and choose whether to proxy through Cloudflare
6. Click **Create Record**

DNS changes take effect within seconds when using Cloudflare's proxy.

> **Note:** DNS records are also created automatically during site deployment if a Cloudflare account is configured.

---

## Step 10 — SSH Terminal

Go to **Terminal** in the sidebar.

1. Select a server from the dropdown
2. The terminal connects immediately over WebSocket + SSH
3. Type any command as you would in a normal terminal
4. Click **Disconnect** or close the tab when done

The terminal supports:
- Full interactive commands (nano, vim, htop, etc.)
- Colour output
- Window resize (auto-fits to browser window)
- 5000 line scrollback buffer

> **Security note:** The terminal connects as the SSH user you configured (usually `root`). Be careful with destructive commands.

---

## Step 11 — Activity Logs

Go to **Activity** in the sidebar to see a full log of every action.

### Filtering

| Filter | Options |
|---|---|
| Type | All, Deploy, SSL, Nginx, DNS, Connection, Error |
| Status | All, Success, Failed, Running |
| Search | Free-text search across message and site/server names |

### Features

- **Expandable rows** — click any log entry to see the full terminal output
- **Auto-refresh** — the page refreshes every 8 seconds when any deploy is running
- **Clear logs** — removes all activity records (with confirmation)
- Status icons: ✅ success, ❌ failed, 🔄 running

---

## Field Reference

### Site Fields

| Field | Required | Description |
|---|---|---|
| Site Name | Yes | Display label for the site |
| Domain | Yes | Domain or subdomain (no `http://`) |
| Server | Yes | Which VPS to deploy to |
| Deploy Path | Yes | Absolute server path to clone the repo into |
| Serve From | No | Subfolder nginx serves (relative or absolute). Leave blank to use Deploy Path |
| Site Type | Yes | `static` / `nodejs` / `php` / `python` |
| Repo URL | No | HTTPS clone URL from GitHub/GitLab/Bitbucket |
| Git Token | No | OAuth/PAT token for private repos |
| Build Command | No | Shell command to run after git pull |
| Auto-sync | No | Enables webhook auto-deploy on push |

### Server Fields

| Field | Required | Description |
|---|---|---|
| Name | Yes | Friendly label |
| Host | Yes | IP address or hostname |
| Port | Yes | SSH port (default `22`) |
| Username | Yes | SSH user (usually `root`) |
| Password | No | SSH password |
| Private Key | No | PEM SSH private key (alternative to password) |

---

## Build Command Examples

| Project type | Build command |
|---|---|
| Plain static site | *(leave blank)* |
| Vite / React | `npm run build` |
| Next.js | `npm run build` |
| Nuxt | `npm run build` |
| pnpm monorepo | `pnpm run build` |
| Skip a sub-package | `pnpm -r --filter '!@workspace/mockup-sandbox' run build` |
| With env vars | `PORT=3000 BASE_PATH=/ pnpm run build` |
| Typecheck + build | `pnpm run typecheck && pnpm run build` |
| Python (no build) | *(leave blank)* |

> **Node.js auto-detection:** If no build command is set and the project is `Node.js` type, the deployer automatically detects your package manager from the lock file (`pnpm-lock.yaml`, `yarn.lock`, or `package-lock.json`), runs `install`, and runs `build` if the script exists.

---

## Serve From Examples

The **Serve From** field tells nginx which folder to serve static files from. It is relative to the Deploy Path unless you start it with `/`.

| Framework | Serve From value |
|---|---|
| Vite / React | `dist` |
| Create React App | `build` |
| Next.js static export | `out` |
| Nuxt static | `dist` |
| pnpm monorepo frontend | `artifacts/vps-manager/dist/public` |
| Hugo | `public` |
| Plain Node.js API | *(leave blank — needs proxy setup)* |
| No build, files at root | *(leave blank)* |

---

## Troubleshooting

### Deploy shows "Permission denied"
- Check that the SSH username and password/key are correct on the Server edit page
- Test the connection from the Server Detail page

### 403 Forbidden after deploy
- The **Serve From** field is probably pointing to the wrong folder, or left blank when it should have a value
- Edit the site, set the correct Serve From path, and click **Save & Redeploy**

### Build fails with "command not found"
- SSH non-login shells have a minimal `$PATH`. Use full binary paths or prefix with `env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`
- For pnpm: the deployer installs it globally automatically if missing

### Nginx reload fails
- Check the Nginx Config viewer for syntax errors
- SSH into the server and run `nginx -t` to see the exact error

### SSL install fails
- Make sure the domain's DNS is already pointing to the server and has propagated
- Make sure Certbot is installed: `apt install certbot python3-certbot-nginx`
- Check that port 80 is open in your firewall

### Webhook not triggering
- Make sure Auto-sync is enabled and you've saved the site
- Check that the webhook URL in GitHub exactly matches what the app shows
- Check the Activity Log for any webhook-triggered deploy entries

### Terminal won't connect
- Verify the server's SSH credentials are correct
- Check that port 22 is open
- Some servers require key auth — add your private key to the server settings
