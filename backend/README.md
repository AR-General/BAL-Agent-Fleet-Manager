# oc-controller backend

Express API for the private fleet cockpit. License: [MIT](../LICENSE).

## Stack

- Node 20+ (see `.nvmrc`), TypeScript, Express, `ws`
- PostgreSQL via Drizzle (`drizzle/` SQL migrations)
- Chat payloads encrypted at rest (`CHAT_ENCRYPTION_KEY`, 32-byte hex)

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | `tsx watch` on `:3800` |
| `npm run build` / `npm start` | Compile and run `dist/` |
| `npm run db:migrate` | Apply Drizzle migrations |
| `npm run db:seed` | Default tenant + admin user |
| `npm run db:seed-demo` | Example `alpha`/`beta` instances + rooms |
| `npm test` | Node test runner on `src/**/*.test.ts` |
| `npm run db:migrate-mongo` | One-shot Mongo → Postgres import |

## Config

Copy [`.env.example`](.env.example) to `.env`. Required at process start:

- `DATABASE_URL`
- `CHAT_ENCRYPTION_KEY` — `openssl rand -hex 32`
- `REFRESH_TOKEN_PEPPER` — same format, used to hash refresh tokens

Optional: `FISH_API_KEY` (TTS proxy), `SPEACHES_URL` (STT), `OC_WORKSPACE_ROOT` (markdown workspaces), `OC_VRM_DIR` / `OC_VRM_UPLOAD_DIR` / `OC_VRM_MAX_BYTES` (VRM library on disk).

Per-instance gateway tokens can be stored encrypted on the instance row, or supplied as `OC_<SLUG>_GATEWAY_TOKEN`.

## Instance runtimes

`POST /api/v1/instances` accepts `identity.runtime`:

| `runtime` | Required | Identity / URLs |
|-----------|----------|-----------------|
| `openclaw` (default) | host, ports | `health_path` `/healthz`; fleet HTTPS/bridge/signal/… |
| `hermes` | host, API port | `api_base` `http://host:apiPort`; `health_path` `/health` |
| `openai-like` | `api_base` | Normalized to `…/v1`; `health_path` `/v1/models`; API key as `gateway_token` |

Agents (`/api/v1/agents`) attach a profile (`agent_id`, display name) to an existing instance, or the UI can create the instance first.

## VRM library

Table `vrm_models` stores **metadata only**. Files:

- `OC_VRM_DIR` (default `data/vrm-library`) — scanned `.vrm` trees
- `OC_VRM_UPLOAD_DIR` (default `data/vrm-uploads`) — `{uuid}.vrm` blobs

Presence `vrm_url` is `oc-vrm:{uuid}`, not a public URL. File bytes require JWT.

| Method | Path | Role |
|--------|------|------|
| `GET` | `/api/v1/vrm-models` | List (scans dir) |
| `POST` | `/api/v1/vrm-models/scan` | admin/operator — rescan directory |
| `POST` | `/api/v1/vrm-models/upload` | admin/operator — raw `.vrm` body |
| `GET` | `/api/v1/vrm-models/:id` | Detail |
| `GET` | `/api/v1/vrm-models/:id/file` | Stream mesh |
| `PATCH` | `/api/v1/vrm-models/:id` | name, description, hidden |
| `DELETE` | `/api/v1/vrm-models/:id` | Hide directory row, or unlink upload |

Upload: `Content-Type: application/octet-stream`, query `filename` / `name`, or header `X-Vrm-Filename`. Default size cap 64 MiB.

## Completions

`src/services/hermesClient.ts` is an OpenAI-compatible streaming client (`/v1/chat/completions`). The portal uses it for group chat, tool rounds, and `character_speak`. Point each instance `api_base` at that gateway.

## Tests

```bash
npm test
```
