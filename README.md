# oc-controller

A **small cockpit** to privately manage your own agent fleet and their channels: register runtimes, stream group chat, and drive 3D VRM companions.

License: **[MIT](LICENSE)**.

This cockpit was built to coordinate agents while [AssetsNexus.org](https://assetsnexus.org) was under development. **Native [Nexus Agents](https://assetsnexus.org) have replaced it for that work.** For professional use, switch to Nexus Agents: context and brain management, data privacy, agent RBAC, 2000+ physical-world skills, MCP, and more. You can still **connect Nexus Agents here** the same way as OpenClaw or Hermes (OpenAI-compatible `api_base`).

OpenClaw, Hermes, and any OpenAI-compatible API remain supported for private / self-hosted fleets.

3D motion and voice: free **character-kit / voice-kit** (MIT), typically checked out as a sibling `../dev-vrm`. This repo is an **integration example**; [AssetsNexus.org](https://assetsnexus.org) is a **utilizing platform**.

![Group chat with 3D VRM companions](docs/screenshots/01-group-chat-3d.png)

![Operator portal](docs/screenshots/02-operator-portal.png)

![Instance channel matrix](docs/screenshots/03-channel-matrix.png)

## Layout

| Path | Role |
|------|------|
| [`backend/`](backend/) | Express + TypeScript API, Drizzle/PostgreSQL |
| [`frontend/`](frontend/) | React + Vite admin / chat UI |
| [`docs/`](docs/) | Operator notes (`CHAT_WORKBENCH.md`). Planning dirs are local-only. |

## Local dev

Postgres at `DATABASE_URL` (default `postgresql://occontroller:occontroller@127.0.0.1:25432/oc_controller`).

```bash
cd backend
cp .env.example .env
# set CHAT_ENCRYPTION_KEY and REFRESH_TOKEN_PEPPER (openssl rand -hex 32)
npm ci && npm run db:migrate && npm run db:seed
npm run dev   # :3800

cd ../frontend
npm install && npm run dev   # :3080, proxies /api → :3800
```

`npm run db:seed` creates an **admin** if missing (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, defaults `admin@localhost` / `changeme`). Override in `backend/.env` **before** seed. To reset a password: `ADMIN_PASSWORD_RESET=true npm run db:seed`.

Optional: `npm run db:seed-demo` registers example instances `alpha` / `beta`. Point `OC_GATEWAY_HOST` at your agent host.

## Instances and agents

| Runtime | Configure | Health |
|---------|-----------|--------|
| OpenClaw | Host, fleet ports, TLS, gateway token | `/healthz` |
| Hermes | Host, API + HTTPS ports, API key | `/health` |
| OpenAI-like | `api_base`, API key, default model (Nexus Agents, OpenAI, …) | `/v1/models` |

Create from **Instances**, or create instance + **Agent** profile together. Default VRM and Fish voice live on instance presence (`oc-vrm:{uuid}`, JWT file fetch — not a public URL).

## VRM library

Meshes are **not** in git or Postgres (metadata only):

| Source | Path | UI delete |
|--------|------|-----------|
| Directory | `OC_VRM_DIR` (default `backend/data/vrm-library`) | Hides row; file stays |
| Upload | `OC_VRM_UPLOAD_DIR` (default `backend/data/vrm-uploads`) | Unlinks file |

Portal: **VRMs** (`/vrms`) — scan, upload, rename, 3D preview. Assign on **Agents** or **Instances → Avatar & voice**.

Model catalogs: [VRoid Hub](https://hub.vroid.com/), [VRoid Studio](https://vroid.com/en/studio), [vrm.dev](https://vrm.dev/en/), [three-vrm sample](https://github.com/pixiv/three-vrm), [Ready Player Me](https://readyplayer.me/), [BOOTH](https://booth.pm/). Read each VRM license.

The frontend `file:` deps and Vite aliases expect **character-kit** at `../dev-vrm` (sibling of this repo, or `services/dev-vrm` in the monorepo). Override with `DEV_VRM_ROOT` if needed.

## Docker

Frontend Docker build context is the **parent of this repo** (so `dev-vrm` and `oc-controller` are siblings):

```bash
./scripts/docker-build-push.sh

# from this directory:
docker build -t oc-controller-backend:latest backend
docker build -f frontend/Dockerfile -t oc-controller-frontend:latest ..
```

`OC_CONTROLLER_REGISTRY` sets the image prefix. `OC_CONTROLLER_SKIP_PUSH=true` builds without push.

## Secrets and private data

Never commit `backend/.env`. Copy `.env.example`. Chat is encrypted at rest (`CHAT_ENCRYPTION_KEY`).

| Kind | Location (gitignored) |
|------|------------------------|
| Keys / tokens | `backend/.env` |
| Agent prompts / workspace markdown | `OC_WORKSPACE_ROOT` |
| VRM files | `OC_VRM_DIR`, `OC_VRM_UPLOAD_DIR` |
| HTTP audit JSONL | `AUDIT_LOG_DIR` (default 30-day retention) |
| Scratch / private meshes | [`local/`](local/README.md) |
| Internal plans | `docs/followups/`, `docs/plans/` (gitignored, not deleted) |

Console HTTP: `HTTP_ACCESS_CONSOLE=quiet` (4xx/5xx only), `all`, or `off`.
# BAL-Agent-Fleet-Manager
