/** In-memory 3D viewport session flags — ephemeral, no DB round-trip. */

import type { SceneEntityDigest, SceneOccupantPose } from "./sceneOccupancy.js";

type ViewportRow = {
  active: boolean;
  updatedAt: number;
  occupants: SceneOccupantPose[];
  entities: SceneEntityDigest[];
};

const viewport3dSessions = new Map<string, ViewportRow>();

const TTL_MS = 1000 * 60 * 60 * 6;

function prune(): void {
  const now = Date.now();
  for (const [id, row] of viewport3dSessions) {
    if (now - row.updatedAt > TTL_MS) viewport3dSessions.delete(id);
  }
}

function emptyRow(active: boolean): ViewportRow {
  return { active, updatedAt: Date.now(), occupants: [], entities: [] };
}

export function setViewport3dActive(sessionId: string, active: boolean): void {
  prune();
  const prev = viewport3dSessions.get(sessionId);
  if (!active) {
    if (!prev) return;
    viewport3dSessions.set(sessionId, {
      active: false,
      updatedAt: Date.now(),
      occupants: prev.occupants,
      entities: prev.entities,
    });
    return;
  }
  viewport3dSessions.set(sessionId, {
    active: true,
    updatedAt: Date.now(),
    occupants: prev?.occupants ?? [],
    entities: prev?.entities ?? [],
  });
}

export function setViewportOccupants(sessionId: string, occupants: SceneOccupantPose[]): void {
  prune();
  const prev = viewport3dSessions.get(sessionId);
  if (!prev?.active) {
    viewport3dSessions.set(sessionId, {
      active: true,
      updatedAt: Date.now(),
      occupants,
      entities: prev?.entities ?? [],
    });
    return;
  }
  viewport3dSessions.set(sessionId, {
    ...prev,
    updatedAt: Date.now(),
    occupants,
  });
}

export function setViewportEntities(sessionId: string, entities: SceneEntityDigest[]): void {
  prune();
  const prev = viewport3dSessions.get(sessionId) || emptyRow(true);
  viewport3dSessions.set(sessionId, {
    ...prev,
    active: true,
    updatedAt: Date.now(),
    entities,
  });
}

export function isViewport3dActive(sessionId: string): boolean {
  prune();
  return viewport3dSessions.get(sessionId)?.active === true;
}

export function getViewportOccupants(sessionId: string): SceneOccupantPose[] {
  prune();
  return viewport3dSessions.get(sessionId)?.occupants ?? [];
}

export function getViewportEntities(sessionId: string): SceneEntityDigest[] {
  prune();
  return viewport3dSessions.get(sessionId)?.entities ?? [];
}
