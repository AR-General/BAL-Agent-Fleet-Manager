---
name: oc-controller
description: Connect this OpenClaw/Hermes agent to BAL Agent Fleet Manager (oc-controller) via OC_CONTROLLER_API_KEY and fleet HTTP tools.
---

# oc-controller / fleet skill

Use this when the operator registered your runtime in **BAL Agent Fleet Manager** and gave you a secret instance API token.

Repo (keep skills in sync): [AR-General/BAL-Agent-Fleet-Manager](https://github.com/AR-General/BAL-Agent-Fleet-Manager) · guide: [CONNECT-AGENT.md](https://github.com/AR-General/BAL-Agent-Fleet-Manager/blob/main/CONNECT-AGENT.md)

## Required env (secret)

Set on the **agent host** (never commit; never paste into public chat):

```bash
OC_CONTROLLER_BASE_URL=https://your-fleet-manager.example   # or http://host:3800
OC_CONTROLLER_API_KEY=oc_inst_…                             # from Instances → API tokens
```

Optional alias some UIs still mention: `OP_CONTROLLER_API_KEY` (same value). Prefer `OC_CONTROLLER_API_KEY`.

## Call tools

Authenticated HTTP (Bearer token):

```http
GET  {OC_CONTROLLER_BASE_URL}/api/v1/tools/schema
POST {OC_CONTROLLER_BASE_URL}/api/v1/tools/invoke
Content-Type: application/json
Authorization: Bearer {OC_CONTROLLER_API_KEY}

{ "tool": "fleet_status", "arguments": {} }
```

Fetch schema once and register tools with your runtime. Do **not** invent tool names — use the schema.

## Useful tools

| Tool | Purpose |
|------|---------|
| `fleet_status` | List fleet instances + health |
| `fleet_register` | Register/update this instance |
| `fleet_push_event` | Push a tagged fleet event |
| `fleet_send_message` / `fleet_check_inbox` | Inter-agent messaging |
| `contacts_list` / `contacts_get` | Contacts directory |
| `chat_list_sessions` / `chat_read_history` / `chat_post_message` | Portal chat sessions |
| `room_list` / `room_create` / `room_dm` / `room_post` / `room_read_history` | Rooms / channels |
| `teams_list` | Teams |
| `workspace_link_files` | Attach workspace paths into a room |

## Also talk in the portal

The operator can chat with you in the fleet **Workbench** (`/chat`). That path uses the instance **gateway** credentials configured on the instance (separate from `OC_CONTROLLER_API_KEY`). Fleet tools above are for agent→controller HTTP; portal chat is controller→your OpenAI-compatible API.

## Optional: VRM / 3D skills

Companion motion (`character_*`, `scene_*`, …) is separate. Sync from [nexus-collaboration-vr skills](https://github.com/assetsnexus/nexus-collaboration-vr/tree/main/skills). Those tools only work when a 3D host (fleet chat viewport or playground) registers them.
