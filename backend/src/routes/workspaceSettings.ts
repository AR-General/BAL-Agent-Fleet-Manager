import { Router } from "express";
import { z } from "zod";
import { requireJwt } from "../middleware/auth.js";
import {
  getWorkspaceSettingsView,
  patchWorkspaceSettings,
} from "../services/workspaceSettings.js";

const router = Router();

router.get("/", requireJwt, async (req, res) => {
  const settings = await getWorkspaceSettingsView(req.user!.tenantId);
  res.json({ settings });
});

router.put("/", requireJwt, async (req, res) => {
  const parsed = z
    .object({
      tts_speak_mode: z.enum(["auto", "tool"]).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const settings = await patchWorkspaceSettings(req.user!.tenantId, parsed.data);
  res.json({ settings });
});

export default router;
