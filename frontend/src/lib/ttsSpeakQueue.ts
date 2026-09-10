/** Group TTS queue helpers — serialize speakers, never drop a peer's job because another started. */

export type SpeakJob<TCue = unknown> = {
  slug: string;
  messageId: string;
  text: string;
  voiceId: string;
  cues: TCue[];
};

/** Drop pending jobs for a slug that belong to an older message. */
export function dropStaleSlugJobs<T>(
  queue: SpeakJob<T>[],
  slug: string,
  keepMessageId: string,
): SpeakJob<T>[] {
  const key = slug.trim().toLowerCase();
  return queue.filter((job) => job.slug.trim().toLowerCase() !== key || job.messageId === keepMessageId);
}

export function dropSlugJobs<T>(queue: SpeakJob<T>[], slug: string): SpeakJob<T>[] {
  const key = slug.trim().toLowerCase();
  return queue.filter((job) => job.slug.trim().toLowerCase() !== key);
}
