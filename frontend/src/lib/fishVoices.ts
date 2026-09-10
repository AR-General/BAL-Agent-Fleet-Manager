export type FishVoiceSource = "workspace" | "library";

export type FishVoice = {
  id: string;
  title: string;
  languages?: string[];
  source: FishVoiceSource;
};

export type FishVoicesResponse = {
  fish_configured?: boolean;
  default_voice_id?: string;
  cached?: boolean;
  voices?: FishVoice[];
};

/** Keep in sync with backend `FISH_LIBRARY_VOICES` / Fish docs. */
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

const VOICE_ID_RE = /^[a-fA-F0-9]{16,64}$/;

export function isFishVoiceId(value: string): boolean {
  return VOICE_ID_RE.test(value);
}

export function resolveFishVoiceId(
  configured?: string | null,
  fallback = DEFAULT_FISH_VOICE_ID,
): string {
  const trimmed = configured?.trim() ?? "";
  if (trimmed && isFishVoiceId(trimmed)) return trimmed;
  return fallback || DEFAULT_FISH_VOICE_ID;
}

export function presenceFishVoiceId(
  presence?: { fishVoiceId?: string | null; fish_voice_id?: string | null } | null,
): string {
  return presence?.fishVoiceId ?? presence?.fish_voice_id ?? "";
}

export function defaultFishVoiceLabel(
  voices: FishVoice[],
  defaultVoiceId = DEFAULT_FISH_VOICE_ID,
): string {
  const match = voices.find((v) => v.id === defaultVoiceId);
  return match?.title ? `Default — ${match.title}` : "Default";
}

export function groupFishVoices(voices: FishVoice[]): {
  workspace: FishVoice[];
  library: FishVoice[];
} {
  const workspace: FishVoice[] = [];
  const library: FishVoice[] = [];
  const seen = new Set<string>();
  for (const voice of voices) {
    if (!voice.id || seen.has(voice.id)) continue;
    seen.add(voice.id);
    if (voice.source === "workspace") workspace.push(voice);
    else library.push(voice);
  }
  return { workspace, library };
}

export function selectVoiceValue(configured: string, defaultVoiceId: string): string {
  const trimmed = configured.trim();
  if (!trimmed || trimmed === defaultVoiceId) return "";
  return trimmed;
}
