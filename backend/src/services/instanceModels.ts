/** LLM catalog for Hermes / OpenClaw instances. Hermes `/v1/models` is the agent alias, not the catalog. */

import { classifyBotRuntime } from "./botRuntime.js";
import { resolveGatewayToken } from "./gatewayToken.js";
import { fetchWithTls } from "../utils/httpFetch.js";
import { isRetryableNetworkError, resolveApiBaseCandidates } from "../utils/instanceEndpoints.js";
import { parseInstanceTls } from "../utils/instanceTls.js";
import { log } from "../utils/logger.js";
import { incMetric } from "../utils/metrics.js";

export type LlmModelOption = {
  id: string;
  owned_by?: string;
  label?: string;
};

export type InstanceModelsResult = {
  slug: string;
  runtime: string;
  default_model: string;
  models: LlmModelOption[];
  error?: string;
};

export type CompletionModelRef = {
  model?: string;
  provider?: string;
  isAgentAlias: boolean;
};

type InstanceLike = {
  slug: string;
  identity?: unknown;
  urls?: unknown;
  tls?: unknown;
  gatewayTokenEncrypted?: string | null;
};

export function isAgentAliasModel(id: string, slug?: string): boolean {
  const raw = id.trim().toLowerCase();
  if (!raw || raw === "default" || raw === "hermes-agent" || raw === "openclaw" || raw === "main") {
    return true;
  }
  if (slug && raw === slug.trim().toLowerCase()) return true;
  if (slug && raw === `openclaw/${slug.trim().toLowerCase()}`) return true;
  if (raw === "openclaw/main") return true;
  return false;
}

/** Persist as `provider:model` when provider is known so chat completions can send both fields. */
export function formatStoredModelId(model: string, provider?: string): string {
  const mid = model.trim();
  const prov = (provider || "").trim();
  if (!mid) return "";
  if (!prov) return mid;
  if (mid.toLowerCase().startsWith(`${prov.toLowerCase()}:`)) return mid;
  return `${prov}:${mid}`;
}

export function parseCompletionModelRef(raw: string | undefined, agentSlug?: string): CompletionModelRef {
  const s = (raw || "").trim();
  if (!s || isAgentAliasModel(s, agentSlug)) {
    return { isAgentAlias: Boolean(s) };
  }
  const colon = s.indexOf(":");
  if (colon > 0) {
    const provider = s.slice(0, colon).trim();
    const model = s.slice(colon + 1).trim();
    if (provider && model && !provider.includes("/")) {
      return { provider, model, isAgentAlias: false };
    }
  }
  return { model: s, isAgentAlias: false };
}

function stringField(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === "string" ? v.trim() : "";
}

function providerRows(payload: Record<string, unknown>): Array<{ slug: string; models: unknown }> {
  const raw = payload.providers;
  if (Array.isArray(raw)) {
    return raw.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const p = row as Record<string, unknown>;
      return [{ slug: String(p.slug || p.id || p.name || "").trim(), models: p.models }];
    });
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>).map(([slug, row]) => {
      if (row && typeof row === "object") {
        const p = row as Record<string, unknown>;
        return { slug: String(p.slug || slug).trim(), models: p.models ?? row };
      }
      return { slug, models: row };
    });
  }
  return [];
}

function modelIdsFromList(list: unknown): string[] {
  if (Array.isArray(list)) {
    return list.flatMap((entry) => {
      if (typeof entry === "string") return entry.trim() ? [entry.trim()] : [];
      if (entry && typeof entry === "object") {
        const rec = entry as { id?: unknown; model?: unknown };
        const id = String(rec.id || rec.model || "").trim();
        return id ? [id] : [];
      }
      return [];
    });
  }
  if (list && typeof list === "object") {
    return Object.entries(list as Record<string, unknown>).flatMap(([key, val]) => {
      if (typeof val === "string" && val.trim()) return [val.trim()];
      if (val && typeof val === "object") {
        const id = String((val as { id?: unknown }).id || key).trim();
        return id ? [id] : [];
      }
      return key ? [key] : [];
    });
  }
  return [];
}

export function flattenHermesModelOptions(payload: unknown, slug?: string): {
  models: LlmModelOption[];
  default_model: string;
} {
  const o = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const current =
    o.current && typeof o.current === "object" ? (o.current as Record<string, unknown>) : {};
  const currentProvider = stringField(o, "provider") || stringField(current, "provider");
  const currentModel = stringField(o, "model") || stringField(current, "model");
  const models: LlmModelOption[] = [];
  const seen = new Set<string>();

  for (const row of providerRows(o)) {
    const provider = row.slug;
    for (const modelId of modelIdsFromList(row.models)) {
      if (!modelId || isAgentAliasModel(modelId, slug)) continue;
      const id = formatStoredModelId(modelId, provider);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      models.push({
        id,
        owned_by: provider || undefined,
        label: modelId,
      });
    }
  }

  const default_model =
    currentModel && !isAgentAliasModel(currentModel, slug)
      ? formatStoredModelId(currentModel, currentProvider)
      : models[0]?.id || "";

  return { models, default_model };
}

export function resolveModelQuery(query: string, models: LlmModelOption[]): LlmModelOption | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const exact = models.find(
    (m) => m.id.toLowerCase() === q || (m.label || "").toLowerCase() === q || m.id.toLowerCase().endsWith(`:${q}`),
  );
  if (exact) return exact;
  const suffix = models.filter(
    (m) =>
      m.id.toLowerCase().includes(q) ||
      (m.label || "").toLowerCase().includes(q) ||
      (m.owned_by || "").toLowerCase() === q,
  );
  if (suffix.length === 1) return suffix[0]!;
  const starts = suffix.filter(
    (m) => (m.label || m.id).toLowerCase().startsWith(q) || m.id.toLowerCase().endsWith(`/${q}`),
  );
  if (starts.length === 1) return starts[0]!;
  return suffix.length ? suffix[0]! : null;
}

function openaiCompatModels(json: unknown, slug?: string): LlmModelOption[] {
  const data =
    json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data)
      ? ((json as { data: unknown[] }).data)
      : [];
  const models: LlmModelOption[] = [];
  for (const m of data) {
    if (!m || typeof m !== "object") continue;
    const rec = m as { id?: unknown; owned_by?: unknown };
    const id = String(rec.id || "").trim();
    if (!id || isAgentAliasModel(id, slug)) continue;
    models.push({
      id,
      owned_by: rec.owned_by ? String(rec.owned_by) : undefined,
      label: id,
    });
  }
  return models;
}

async function fetchInstanceJson(opts: {
  bases: string[];
  token: string;
  path: string;
  slug: string;
  allowSelfSigned: boolean;
  timeoutMs?: number;
}): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  let lastErr: unknown;
  for (let i = 0; i < opts.bases.length; i++) {
    const url = `${opts.bases[i]}${opts.path.startsWith("/") ? opts.path : `/${opts.path}`}`;
    try {
      const res = await fetchWithTls(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${opts.token}` },
        timeoutMs: opts.timeoutMs ?? 15_000,
        allowSelfSigned: opts.allowSelfSigned,
      });
      const text = await res.text();
      let json: unknown = text;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text.slice(0, 300) };
      }
      if (i > 0 && res.ok) {
        incMetric("oc_hermes_endpoint_fallback_total", "Hermes calls that succeeded on a fallback host");
        log.warn({ slug: opts.slug, base: opts.bases[i], path: opts.path }, "instance fetch succeeded on fallback");
      }
      return { ok: res.ok, status: res.status, json, text };
    } catch (e) {
      lastErr = e;
      if (i === opts.bases.length - 1 || !isRetryableNetworkError(e)) throw e;
      log.warn(
        { err: e, slug: opts.slug, from: opts.bases[i], to: opts.bases[i + 1], path: opts.path },
        "instance fetch failed, trying fallback",
      );
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("instance fetch failed");
}

export async function listInstanceLlmModels(inst: InstanceLike): Promise<InstanceModelsResult> {
  const identity = (inst.identity || {}) as Record<string, unknown>;
  const urls = (inst.urls || {}) as Record<string, string>;
  const runtime = String(identity.runtime || "unknown");
  const kind = classifyBotRuntime(runtime);
  const identityDefault =
    typeof identity.default_model === "string" ? identity.default_model.trim() : "";
  const fallbackDefault = identityDefault && !isAgentAliasModel(identityDefault, inst.slug) ? identityDefault : "";

  const bases = resolveApiBaseCandidates({ urls, identity });
  if (!bases.length) {
    return { slug: inst.slug, runtime, default_model: fallbackDefault, models: [], error: "api_base missing" };
  }
  const token = resolveGatewayToken({
    slug: inst.slug,
    gatewayTokenEncrypted: inst.gatewayTokenEncrypted ?? null,
  });
  if (!token) {
    return {
      slug: inst.slug,
      runtime,
      default_model: fallbackDefault,
      models: [],
      error: "api_key_missing",
    };
  }
  const tls = parseInstanceTls({ tls: inst.tls, identity });

  try {
    const options = await fetchInstanceJson({
      bases,
      token,
      path: "/api/model/options",
      slug: inst.slug,
      allowSelfSigned: tls.allow_self_signed,
      timeoutMs: 25_000,
    });
    if (options.ok) {
      const flat = flattenHermesModelOptions(options.json, inst.slug);
      if (flat.models.length) {
        incMetric("oc_instance_model_catalog_total", "Instance LLM catalogs loaded from /api/model/options");
        log.info(
          { slug: inst.slug, count: flat.models.length, default_model: flat.default_model },
          "loaded Hermes LLM catalog",
        );
        return {
          slug: inst.slug,
          runtime,
          default_model: flat.default_model || fallbackDefault,
          models: flat.models,
        };
      }
      log.warn({ slug: inst.slug }, "Hermes /api/model/options returned no LLM ids");
    } else {
      log.warn(
        { slug: inst.slug, status: options.status, detail: options.text.slice(0, 200) },
        "Hermes /api/model/options failed",
      );
    }
  } catch (e) {
    log.warn({ err: e, slug: inst.slug }, "Hermes /api/model/options threw");
  }

  try {
    const upstream = await fetchInstanceJson({
      bases,
      token,
      path: "/v1/models",
      slug: inst.slug,
      allowSelfSigned: tls.allow_self_signed,
    });
    if (!upstream.ok) {
      return {
        slug: inst.slug,
        runtime,
        default_model: fallbackDefault,
        models: [],
        error: `upstream HTTP ${upstream.status}`,
      };
    }
    const models = openaiCompatModels(upstream.json, inst.slug);
    if (!models.length) {
      return {
        slug: inst.slug,
        runtime,
        default_model: fallbackDefault,
        models: [],
        error:
          kind === "openclaw"
            ? "OpenClaw /v1/models lists agents, not LLMs; use Hermes /api/model/options-compatible runtimes"
            : "no LLM models in /v1/models (agent alias only)",
      };
    }
    return {
      slug: inst.slug,
      runtime,
      default_model: fallbackDefault || models[0]!.id,
      models,
    };
  } catch (e) {
    return {
      slug: inst.slug,
      runtime,
      default_model: fallbackDefault,
      models: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function fetchInstanceHealthDetailed(
  inst: InstanceLike,
): Promise<Record<string, unknown> | null> {
  const identity = (inst.identity || {}) as Record<string, unknown>;
  const urls = (inst.urls || {}) as Record<string, string>;
  const bases = resolveApiBaseCandidates({ urls, identity });
  const token = resolveGatewayToken({
    slug: inst.slug,
    gatewayTokenEncrypted: inst.gatewayTokenEncrypted ?? null,
  });
  if (!bases.length || !token) return null;
  const tls = parseInstanceTls({
    tls: inst.tls,
    identity,
  });
  try {
    const res = await fetchInstanceJson({
      bases,
      token,
      path: "/health/detailed",
      slug: inst.slug,
      allowSelfSigned: tls.allow_self_signed,
      timeoutMs: 8_000,
    });
    if (!res.ok || !res.json || typeof res.json !== "object") return null;
    return res.json as Record<string, unknown>;
  } catch (e) {
    log.warn({ err: e, slug: inst.slug }, "health/detailed unavailable");
    return null;
  }
}
