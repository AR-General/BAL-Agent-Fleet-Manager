import { Router } from "express";
import express from "express";
import fs from "node:fs";
import { z } from "zod";
import { config } from "../config.js";
import { requireJwt, requireRole } from "../middleware/auth.js";
import { routeParam } from "../utils/params.js";
import { log } from "../utils/logger.js";
import {
  deleteVrmModel,
  getVrmModel,
  listVrmModels,
  resolveVrmFilePath,
  syncDirectoryModels,
  updateVrmModel,
  uploadVrmModel,
} from "../services/vrmLibrary.js";

const router = Router();

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  hidden: z.boolean().optional(),
});

function statusOf(err: unknown): number {
  const n = (err as { status?: number }).status;
  return typeof n === "number" ? n : 500;
}

router.get("/", requireJwt, async (req, res) => {
  try {
    const includeHidden = String(req.query.include_hidden || "") === "1";
    const models = await listVrmModels(req.user!.tenantId, { includeHidden });
    res.json({ models, library_dir: config.vrmLibraryDir });
  } catch (err) {
    log.error({ err }, "vrm models list failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "list failed" });
  }
});

router.post("/scan", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  try {
    const created = await syncDirectoryModels(req.user!.tenantId);
    const models = await listVrmModels(req.user!.tenantId, { includeHidden: true });
    res.json({ created, models });
  } catch (err) {
    log.error({ err }, "vrm directory scan failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "scan failed" });
  }
});

router.post(
  "/upload",
  requireJwt,
  requireRole("admin", "operator"),
  express.raw({ type: () => true, limit: config.vrmMaxBytes }),
  async (req, res) => {
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
    const filename = String(req.query.filename || req.headers["x-vrm-filename"] || "model.vrm");
    const name = typeof req.query.name === "string" ? req.query.name : undefined;
    const description = typeof req.query.description === "string" ? req.query.description : undefined;
    try {
      const model = await uploadVrmModel({
        tenantId: req.user!.tenantId,
        buffer: buf,
        filename,
        name,
        description,
      });
      res.status(201).json({ model });
    } catch (err) {
      const status = statusOf(err);
      if (status >= 500) log.error({ err }, "vrm upload failed");
      else log.warn({ err: err instanceof Error ? err.message : err }, "vrm upload rejected");
      res.status(status >= 400 ? status : 400).json({
        error: err instanceof Error ? err.message : "upload failed",
      });
    }
  },
);

router.get("/:id/file", requireJwt, async (req, res) => {
  const id = routeParam(req.params.id);
  try {
    const file = await resolveVrmFilePath(req.user!.tenantId, id);
    if (!file) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.setHeader("Content-Type", file.mime);
    res.setHeader("Content-Disposition", `inline; filename="${file.filename.replace(/"/g, "")}"`);
    fs.createReadStream(file.absPath).pipe(res);
  } catch (err) {
    log.error({ err, id }, "vrm file stream failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "read failed" });
  }
});

router.get("/:id", requireJwt, async (req, res) => {
  const id = routeParam(req.params.id);
  const model = await getVrmModel(req.user!.tenantId, id);
  if (!model) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ model });
});

router.patch("/:id", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const model = await updateVrmModel(req.user!.tenantId, routeParam(req.params.id), parsed.data);
    if (!model) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ model });
  } catch (err) {
    const status = statusOf(err);
    res.status(status >= 400 ? status : 400).json({
      error: err instanceof Error ? err.message : "update failed",
    });
  }
});

router.delete("/:id", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  try {
    const result = await deleteVrmModel(req.user!.tenantId, routeParam(req.params.id));
    if (!result) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ok: true, result });
  } catch (err) {
    log.error({ err }, "vrm delete failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "delete failed" });
  }
});

export default router;
