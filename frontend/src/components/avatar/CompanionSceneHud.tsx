/**
 * @deprecated Controls moved into AvatarConfigPanel via useCompanionSceneControls.
 * Kept as a no-op export so older imports do not break during HMR.
 */
export function CompanionSceneHud(_props: {
  host: unknown;
  focusedSlug: string;
  mood: string;
  onMoodChange: (mood: string) => void;
}) {
  return null;
}
