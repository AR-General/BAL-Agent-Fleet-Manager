import type { SceneOccupantPose, SceneRoomOccupant } from "@openclaw/character-kit";
import {
  presenceTone,
  presenceToneHex,
  type AgentPresence,
} from "./participantPresence.ts";

export type GroupSceneAvatarInput = {
  slug: string;
  vrmUrl: string;
  mood: string;
};

export type OccupantPoseHint = {
  x: number;
  z: number;
  facing: number;
};

export function posesBySlug(poses: SceneOccupantPose[]): Map<string, OccupantPoseHint> {
  const map = new Map<string, OccupantPoseHint>();
  for (const pose of poses) {
    if (!Number.isFinite(pose.x) || !Number.isFinite(pose.z) || !Number.isFinite(pose.facing)) {
      continue;
    }
    map.set(pose.slug, { x: pose.x, z: pose.z, facing: pose.facing });
  }
  return map;
}

export function mergeOccupantPoses(
  occupants: SceneRoomOccupant[],
  poses: SceneOccupantPose[],
): SceneRoomOccupant[] {
  const bySlug = posesBySlug(poses);
  if (!bySlug.size) return occupants;
  return occupants.map((occupant) => {
    const pose = bySlug.get(occupant.id);
    if (!pose) return occupant;
    return { ...occupant, x: pose.x, z: pose.z, facing: pose.facing };
  });
}

/** One occupant per reserved spawn slot, with that agent's own mood. */
export function buildGroupOccupants(
  slugs: string[],
  avatars: GroupSceneAvatarInput[],
  presenceBySlug: Record<string, AgentPresence>,
  savedPoses: SceneOccupantPose[] = [],
): SceneRoomOccupant[] {
  const bySlug = new Map(avatars.map((a) => [a.slug, a]));
  const poseMap = posesBySlug(savedPoses);
  return slugs.map((slug, slotIndex) => {
    const avatar = bySlug.get(slug);
    const presence = presenceBySlug[slug];
    const tone = presenceTone(presence?.status, presence?.online);
    const knownOffline = Boolean(presence) && !presence!.online;
    const present = !knownOffline && Boolean(avatar?.vrmUrl);
    const pose = poseMap.get(slug);
    return {
      id: slug,
      label: slug,
      slotIndex,
      vrmUrl: present ? avatar?.vrmUrl : null,
      mood: avatar?.mood || "neutral",
      statusColor: presenceToneHex(tone),
      present,
      ...(pose ? { x: pose.x, z: pose.z, facing: pose.facing } : {}),
    };
  });
}

/** Prefer the speaking author, then the selected nametag, then the first slot. */
export function resolveGroupSpeakerSlug(
  ttsAuthorSlug: string | undefined,
  agentAuthorSlug: string | undefined,
  selectedSlug: string | null | undefined,
  slugs: string[],
): string {
  for (const slug of [ttsAuthorSlug, agentAuthorSlug, selectedSlug]) {
    if (slug && slugs.includes(slug)) return slug;
  }
  return slugs[0] || "";
}
