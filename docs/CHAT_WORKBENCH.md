# Chat workbench

Portal `/chat` (Vite `:3080` → API `:3800`).

## Setup

1. Set `CHAT_ENCRYPTION_KEY` to 64 hex chars in `backend/.env` (required at boot).
2. Migrate + seed:

```bash
cd services/oc-controller/backend
npm run db:migrate
npm run db:seed
npm run db:seed-demo   # optional example instances alpha/beta
```

3. Per-instance completions: store a gateway token on the instance, or set `OC_<SLUG>_API_KEY` / `OC_<SLUG>_GATEWAY_TOKEN` and re-run `db:seed-demo`.
4. Workspace markdown (optional): set `OC_WORKSPACE_ROOT` to a directory of agent workspaces.

## Features

- Sessions / named rooms / auto rooms from event mentions
- Streaming agent replies (human messages only — anti-loop)
- Chat WS auto-reconnect; subscribe sends `session_sync` so a backend restart cannot leave the UI stuck on “writing”
- Fleet events with tags + mentions
- Voice dock (Speaches / Whisper + Fish TTS)
- Multi-avatar 3D viewport (`@openclaw/character-kit` `SceneRoom`)
- Group roster: **+ Add** in the participant row and **Members** (add/remove)
- Workspace file API under `/api/v1/workspace`
