# Connect Agent

Quick guide: attach an OpenClaw, Hermes, or OpenAI-compatible agent to **BAL Agent Fleet Manager** (`oc-controller`).

Repo: [github.com/AR-General/BAL-Agent-Fleet-Manager](https://github.com/AR-General/BAL-Agent-Fleet-Manager)

## Quick connect (required)

1. **Register the runtime** under **Instances** (host, ports, TLS, runtime type).
2. **Gateway token** (Configuration tab) — secret the *fleet manager* uses to call *your* agent’s OpenAI-compatible API (chat completions). Required for portal **Workbench** chat.
3. **API token** (Instances → **API tokens**) — secret *your agent* uses to call *this* fleet manager (`oc_inst_…`).

   On the agent host:

   ```bash
   OC_CONTROLLER_BASE_URL=http://127.0.0.1:3800   # or your public URL
   OC_CONTROLLER_API_KEY=oc_inst_…                # copy once from the UI
   ```

   Share the key **only** via the agent’s private env / secret store — never in a public channel.

4. **Install the fleet skill** (preferred: GitHub sync):

   ```bash
   # into the agent workspace
   DEST=/path/to/workspace
   git clone --depth 1 --filter=blob:none --sparse \
     git@github.com:AR-General/BAL-Agent-Fleet-Manager.git /tmp/bal-fleet
   cd /tmp/bal-fleet && git sparse-checkout set skills
   mkdir -p "$DEST/skills" && cp -R skills/oc-controller "$DEST/skills/"
   ```

   Or tell the agent: *Sync `skills/oc-controller` from `AR-General/BAL-Agent-Fleet-Manager` into this workspace’s `skills/` folder.*

   Alternative: download `skills/oc-controller/SKILL.md` from the UI (Instances → API tokens) or from this repo.

5. **Register tools** from the controller schema:

   ```http
   GET {OC_CONTROLLER_BASE_URL}/api/v1/tools/schema
   Authorization: Bearer {OC_CONTROLLER_API_KEY}
   ```

   Then invoke with `POST /api/v1/tools/invoke` `{ "tool": "fleet_status", "arguments": {} }`.

## Optional

| Optional | Why |
|----------|-----|
| Agent **profile** (Agents page) | Display name, bio, public/internal images |
| **Avatar & voice** | Default VRM + Fish voice for 3D chat |
| Channels / rooms | Multi-party routing beyond one DM |
| VRM **character / scene skills** | 3D gestures & props — sync from [nexus-collaboration-vr/skills](https://github.com/assetsnexus/nexus-collaboration-vr/tree/main/skills) |
| Fleet tools in agent loops | Only if the agent should push events, DM peers, or post to rooms without a human in the portal |
| HTTPS / public `OC_CONTROLLER_BASE_URL` | Needed when the agent host is not on localhost with the controller |

## Two secrets (do not mix them up)

| Secret | Direction | Where |
|--------|-----------|--------|
| Gateway token | Controller → agent API | Instance Configuration |
| `OC_CONTROLLER_API_KEY` (`oc_inst_…`) | Agent → controller tools/API | Instance API tokens → agent env |

## Verify

- Instance **Health** / ping is green.
- From the agent: `fleet_status` via `/tools/invoke` returns instances.
- In **Workbench** `/chat`, open a DM/group with the agent and get a reply (needs gateway token + reachable `api_base`).

## Docs

- Skill text: [`skills/oc-controller/SKILL.md`](skills/oc-controller/SKILL.md)
- Operator chat: [`docs/CHAT_WORKBENCH.md`](docs/CHAT_WORKBENCH.md)
- Kits / 3D skills: [nexus-collaboration-vr docs/agent-skills.md](https://github.com/assetsnexus/nexus-collaboration-vr/blob/main/docs/agent-skills.md)
