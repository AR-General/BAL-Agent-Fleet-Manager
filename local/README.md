# Local data (not committed)

Everything in this folder except this README is gitignored.

Do not store API keys, chat dumps, or agent prompts in git. Use env and these paths instead:

| Config | Default / notes |
|--------|-----------------|
| `backend/.env` | Secrets (`CHAT_ENCRYPTION_KEY`, JWT, Fish, Twilio, gateway tokens) |
| `OC_WORKSPACE_ROOT` | Agent workspace trees (`SOUL.md`, skills, custom prompts) |
| `OC_VRM_DIR` | Directory-backed VRM library (default `backend/data/vrm-library`) |
| `OC_VRM_UPLOAD_DIR` | Uploaded VRM blobs (default `backend/data/vrm-uploads`) |
| `AUDIT_LOG_DIR` | HTTP audit JSONL (default `backend/data/audit`) |

`backend/data/` is gitignored.
