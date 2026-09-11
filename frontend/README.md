# oc-controller frontend

React + Vite UI for the small private fleet cockpit (`http://localhost:3080` in dev). Proxies `/api` to the backend on `:3800`.

Screenshots and product framing: [package README](../README.md). For professional agent ops, [Nexus Agents](https://assetsnexus.org). BIM/IFC, wiring, and VR/AR are out of scope here (AssetsNexus.org).

## Pages

| Route | Purpose |
|-------|---------|
| `/instances` | Register OpenClaw / Hermes / OpenAI-like runtimes |
| `/instances/:slug` | Config, avatar & voice, channels, tokens |
| `/agents` | Profiles bound to an instance |
| `/vrms` | Tenant VRM library |
| `/chat` | Group/DM workbench |
| `/instances/channels` | Fleet channel matrix |

## VRM runtime

Depends on `@nexus/character-kit` / scene kits from [nexus-collaboration-vr](https://github.com/assetsnexus/nexus-collaboration-vr) (`file:../../dev-vrm/...`, or set `DEV_VRM_ROOT`). Vite aliases to **source**.

Meshes: drop into `OC_VRM_DIR` or **Upload VRM**. Catalog for playground-style demo URLs: `/dev-vrm-assets/vrm/` (gitignored binaries).

```bash
npm install
npm run dev     # :3080
npm run build
npm test
```

Optional: `SPEACHES_URL` (default `http://127.0.0.1:8090`) before `npm run dev`.
