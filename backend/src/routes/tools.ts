import { Router, type Request } from "express";
import { z } from "zod";
import { requireJwtOrInstance } from "../middleware/auth.js";
import { openAiToolSchemas, assertToolScope } from "../services/toolRegistry.js";
import { executeTool } from "../services/toolExecutor.js";
import { RoomAccessError } from "../services/roomAcl.js";

const router = Router();

function scopesFromReq(req: Request): string[] {
  if (req.authInstance) return req.authInstance.scopes;
  if (req.user) {
    return [
      "fleet:read",
      "fleet:write",
      "events:push",
      "messages:send",
      "chat:read",
      "chat:post",
      "contacts:read",
      "tools:invoke",
      "rooms:read",
      "rooms:write",
      "workspace:read",
      "workspace:write",
    ];
  }
  return [];
}

router.get("/schema", requireJwtOrInstance, (req, res) => {
  res.json({ tools: openAiToolSchemas(scopesFromReq(req)) });
});

const invokeSchema = z.object({
  tool: z.string(),
  arguments: z.record(z.unknown()).optional(),
});

router.post("/invoke", requireJwtOrInstance, async (req, res) => {
  const parsed = invokeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const scopes = scopesFromReq(req);
    assertToolScope(parsed.data.tool, scopes);
    const result = await executeTool(parsed.data.tool, parsed.data.arguments || {}, {
      user: req.user,
      instance: req.authInstance,
      scopes,
    });
    res.json({ ok: true, result });
  } catch (e) {
    if (e instanceof RoomAccessError) {
      res.status(403).json({ error: e.message });
      return;
    }
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const toolsRouter = router;
export { toolsRouter };
export default toolsRouter;
