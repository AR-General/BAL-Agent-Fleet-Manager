import { incMetric } from "../utils/metrics.js";

export const FISH_API_BASE = "https://api.fish.audio";
export const FISH_PCM_SAMPLE_RATE = 24_000;
/** Smaller chunks start audio sooner (Fish range 100–300). */
export const FISH_TTS_CHUNK_LENGTH = 100;
const MODEL_LIST_TTL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 12_000;
const VOICE_ID_RE = /^[a-fA-F0-9]{16,64}$/;

export type FishVoiceSource = "workspace" | "library";

export type FishVoice = {
  id: string;
  title: string;
  languages: string[];
  source: FishVoiceSource;
};

/** Public models from Fish docs — used as catalog + default when none is configured. */
export const FISH_LIBRARY_VOICES: FishVoice[] = [
  {
    id: "ca3007f96ae7499ab87d27ea3599956a",
    title: "E-Girl",
    languages: ["en"],
    source: "library",
  },
  {
    id: "9a9cf47702da476aa4629e2506d4a857",
    title: "Energetic Male",
    languages: ["en"],
    source: "library",
  },
];

export const DEFAULT_FISH_VOICE_ID = FISH_LIBRARY_VOICES[0]!.id;

export type FishFetch = (url: string, init?: RequestInit) => Promise<Response>;

type ModelCache = {
  at: number;
  voices: FishVoice[];
};

let modelCache: ModelCache | null = null;

export function configuredDefaultFishVoiceId(override?: string | null): string {
  const trimmed = override?.trim() ?? "";
  return trimmed || DEFAULT_FISH_VOICE_ID;
}

export function isFishVoiceId(value: string): boolean {
  return VOICE_ID_RE.test(value);
}

/** Prefer a requested id; otherwise the configured / documented default. */
export function resolveTtsVoiceId(
  requested: string | null | undefined,
  fallback = configuredDefaultFishVoiceId(),
): string {
  const trimmed = requested?.trim() ?? "";
  if (trimmed && isFishVoiceId(trimmed)) return trimmed;
  return fallback;
}

export function parseFishModelItem(raw: unknown, source: FishVoiceSource): FishVoice | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const idRaw = rec._id ?? rec.id;
  if (typeof idRaw !== "string" || !isFishVoiceId(idRaw.trim())) return null;
  const title =
    (typeof rec.title === "string" && rec.title.trim()) ||
    (typeof rec.name === "string" && rec.name.trim()) ||
    idRaw.trim();
  const languages = Array.isArray(rec.languages)
    ? rec.languages.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  return { id: idRaw.trim(), title, languages, source };
}

export function parseFishModelList(payload: unknown, source: FishVoiceSource): FishVoice[] {
  const items = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : [];
  const out: FishVoice[] = [];
  for (const item of items) {
    const parsed = parseFishModelItem(item, source);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function mergeFishVoices(groups: FishVoice[][]): FishVoice[] {
  const seen = new Set<string>();
  const out: FishVoice[] = [];
  for (const group of groups) {
    for (const voice of group) {
      if (!voice.id || seen.has(voice.id)) continue;
      seen.add(voice.id);
      out.push(voice);
    }
  }
  return out;
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

async function fetchJson(
  url: string,
  apiKey: string,
  fetchImpl: FishFetch,
): Promise<unknown> {
  const res = await fetchImpl(url, {
    headers: authHeaders(apiKey),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Fish model list ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return res.json();
}

export async function listFishVoices(opts: {
  apiKey?: string;
  fetchImpl?: FishFetch;
  bypassCache?: boolean;
} = {}): Promise<{ voices: FishVoice[]; cached: boolean; errors: string[] }> {
  const apiKey = (opts.apiKey ?? "").trim();
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (!opts.bypassCache && modelCache && Date.now() - modelCache.at < MODEL_LIST_TTL_MS) {
    return { voices: modelCache.voices, cached: true, errors: [] };
  }

  const library = [...FISH_LIBRARY_VOICES];
  if (!apiKey) {
    const voices = mergeFishVoices([library]);
    modelCache = { at: Date.now(), voices };
    return { voices, cached: false, errors: [] };
  }

  const workspace: FishVoice[] = [];
  const popular: FishVoice[] = [];
  const errors: string[] = [];

  try {
    const selfPayload = await fetchJson(
      `${FISH_API_BASE}/model?self=true&page_size=50&page_number=1`,
      apiKey,
      fetchImpl,
    );
    workspace.push(...parseFishModelList(selfPayload, "workspace"));
  } catch (err) {
    incMetric("oc_controller_fish_voices_errors_total", "Fish voice catalog fetch failures");
    errors.push(err instanceof Error ? err.message : String(err));
  }

  try {
    const publicPayload = await fetchJson(
      `${FISH_API_BASE}/model?page_size=20&page_number=1&sort_by=task_count`,
      apiKey,
      fetchImpl,
    );
    popular.push(...parseFishModelList(publicPayload, "library"));
  } catch (err) {
    incMetric("oc_controller_fish_voices_errors_total", "Fish voice catalog fetch failures");
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const voices = mergeFishVoices([workspace, library, popular]);
  modelCache = { at: Date.now(), voices };
  incMetric("oc_controller_fish_voices_fetch_total", "Fish voice catalog refreshes");
  return { voices, cached: false, errors };
}

export type TtsAudioFormat = "mp3" | "wav" | "opus" | "pcm";

export function buildTtsBody(opts: {
  text: string;
  voiceId: string;
  format: TtsAudioFormat;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    text: opts.text,
    reference_id: opts.voiceId,
    format: opts.format,
    normalize: true,
    latency: "balanced",
    chunk_length: FISH_TTS_CHUNK_LENGTH,
  };
  if (opts.format === "mp3") body.mp3_bitrate = 128;
  if (opts.format === "pcm") body.sample_rate = FISH_PCM_SAMPLE_RATE;
  return body;
}

export function resetFishVoiceCache(): void {
  modelCache = null;
}
