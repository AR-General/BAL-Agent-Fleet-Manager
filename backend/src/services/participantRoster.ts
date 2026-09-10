/** Pure roster rules for chat session instance participants. */

export function duplicateParticipantError(
  existingInstanceIds: readonly string[],
  newInstanceId: string,
): string | null {
  if (existingInstanceIds.includes(newInstanceId)) {
    return "already a participant of this session";
  }
  return null;
}

export function lastParticipantRemoveError(instanceCount: number): string | null {
  if (instanceCount <= 1) return "cannot remove the last agent participant";
  return null;
}

export function shouldPromoteToGroup(sessionType: string, instanceCountAfterAdd: number): boolean {
  return sessionType === "direct" && instanceCountAfterAdd >= 2;
}
