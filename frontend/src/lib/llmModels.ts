export type LlmModelOption = { id: string; owned_by?: string; label?: string };

export function isAgentAliasModelId(id: string, slug?: string): boolean {
  const raw = id.trim().toLowerCase();
  if (!raw || raw === "default" || raw === "hermes-agent" || raw === "openclaw" || raw === "main") {
    return true;
  }
  if (slug && raw === slug.trim().toLowerCase()) return true;
  if (slug && raw === `openclaw/${slug.trim().toLowerCase()}`) return true;
  return false;
}

export function filterLlmCatalog(models: LlmModelOption[] | undefined, slug?: string): LlmModelOption[] {
  return (models || []).filter((m) => m.id && !isAgentAliasModelId(m.id, slug));
}

export function llmOptionLabel(model: LlmModelOption): string {
  const core = model.label || (model.id.includes(":") ? model.id.slice(model.id.indexOf(":") + 1) : model.id);
  return model.owned_by ? `${core} · ${model.owned_by}` : core;
}
