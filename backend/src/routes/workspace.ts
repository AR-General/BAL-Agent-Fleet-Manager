import { Router } from "express";
import { requireJwt, requireJwtOrInstance } from "../middleware/auth.js";
import {
  listWorkspace,
  readWorkspaceFile,
  writeWorkspaceFile,
  WorkspacePathError,
  WorkspaceUnavailableError,
} from "../services/workspaceFs.js";
import { broadcastTenantEvent } from "../services/chatWs.js";

const router = Router();

function handleErr(res: import("express").Response, e: unknown) {
  if (e instanceof WorkspaceUnavailableError || e instanceof WorkspacePathError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
}

router.get("/tree", requireJwtOrInstance, async (req, res) => {
  try {
    const rel = String(req.query.path || "");
    const entries = await listWorkspace(rel);
    res.json({ path: rel, entries });
  } catch (e) {
    handleErr(res, e);
  }
});

router.get("/file", requireJwtOrInstance, async (req, res) => {
  try {
    const rel = String(req.query.path || "");
    if (!rel) {
      res.status(400).json({ error: "path required" });
      return;
    }
    const file = await readWorkspaceFile(rel);
    res.setHeader("ETag", file.etag);
    res.json(file);
  } catch (e) {
    handleErr(res, e);
  }
});

router.put("/file", requireJwtOrInstance, async (req, res) => {
  try {
    const rel = String(req.body?.path || req.query.path || "");
    const content = String(req.body?.content ?? "");
    if (!rel) {
      res.status(400).json({ error: "path required" });
      return;
    }
    const ifMatch = (req.headers["if-match"] as string) || req.body?.etag;
    const result = await writeWorkspaceFile(rel, content, ifMatch);
    const tid = req.user?.tenantId || req.authInstance?.tenantId;
    if (tid) {
      broadcastTenantEvent(tid, {
        type: "workspace_file_changed",
        path: rel,
        mtimeMs: result.mtimeMs,
        etag: result.etag,
      });
    }
    res.setHeader("ETag", result.etag);
    res.json({ ok: true, ...result, path: rel });
  } catch (e) {
    handleErr(res, e);
  }
});

export default router;
