import { Router } from "express";
import { requireJwt } from "../middleware/auth.js";
import { getLlmModelMeta } from "../services/llmModelMeta.js";

const router = Router();

router.get("/", requireJwt, async (req, res) => {
  const force = String(req.query.refresh || "") === "1";
  const meta = await getLlmModelMeta({ force });
  res.json(meta);
});

export default router;
