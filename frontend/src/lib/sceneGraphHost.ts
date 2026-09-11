/**
 * Client-authoritative scene graph host for oc-controller viewports.
 * Avatars stay on SceneRoom / CompanionHost; objects/robots live here.
 */
import {
  SceneGraph,
  SceneEventLog,
  StorageTransport,
  attachAutoPersist,
  restoreGraph,
  type SceneEntityDigest,
  type ScenePose,
} from "@nexus/scene-kit";
import { ObjectSceneLayer, type ObjectCatalogEntry, DEFAULT_URL_POLICY, parseAllowHosts } from "@nexus/objects-kit";
import { RobotSceneLayer } from "@nexus/robots-kit";
import {
  handleToolCallEvent,
  DEFAULT_TOOLS_VIZ,
  type ToolsVizDefaults,
  type ToolCallEvent,
} from "@nexus/agent-tools-kit";
import type { CompanionHost } from "@nexus/character-kit";
import type { SceneRoom } from "@nexus/character-kit";
import * as THREE from "three";

export type SceneGraphHost = {
  graph: SceneGraph;
  events: SceneEventLog;
  objects: ObjectSceneLayer;
  robots: RobotSceneLayer;
  defaults: ToolsVizDefaults;
  dispose: () => void;
  tick: () => void;
  digest: () => SceneEntityDigest[];
  getAgentPose: (slug: string) => ScenePose | undefined;
  handleToolEvent: (ev: ToolCallEvent) => string[];
  setSelected: (id: string | null) => void;
  pick: (clientX: number, clientY: number) => string | null;
};

/** Minimal Three attach surface shared by SceneRoom and CompanionHost. */
export type SceneHostBridge = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  getAgentPose: (slug: string) => ScenePose | undefined;
};

export const DEFAULT_CATALOG: ObjectCatalogEntry[] = [
  {
    id: "desk",
    label: "Desk",
    tags: ["furniture", "desk"],
    // size.y = tabletop height; procedural mesh builds legs to the floor.
    spec: {
      shape: "box",
      color: "#8b7355",
      catalogId: "desk",
      size: { x: 1.28, y: 0.74, z: 0.68 },
      radius: 0.7,
      material: { roughness: 0.72, metalness: 0.05 },
    },
  },
  {
    id: "desk-5",
    label: "Desk (compact)",
    tags: ["furniture", "desk"],
    spec: {
      shape: "box",
      color: "#6b5a45",
      catalogId: "desk-5",
      size: { x: 1.05, y: 0.72, z: 0.58 },
      radius: 0.58,
    },
  },
  {
    id: "crate",
    label: "Crate",
    tags: ["prop"],
    spec: { shape: "box", color: "#a67c52", size: { x: 0.5, y: 0.5, z: 0.5 }, radius: 0.35 },
  },
];

function browserStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function bridgeFromSceneRoom(room: SceneRoom): SceneHostBridge {
  return {
    scene: room.scene,
    camera: room.camera,
    renderer: room.renderer,
    getAgentPose: (slug: string): ScenePose | undefined => {
      try {
        const handle = room.getAvatar(slug);
        if (!handle) return undefined;
        const snap = handle.controller.getLocomotionSnapshot?.();
        if (snap && Number.isFinite(snap.x) && Number.isFinite(snap.z)) {
          return { x: snap.x, y: 0, z: snap.z, yaw: snap.facing ?? 0 };
        }
        const pos = handle.worldPosition();
        return { x: pos.x, y: 0, z: pos.z, yaw: 0 };
      } catch {
        return undefined;
      }
    },
  };
}

export function bridgeFromCompanion(host: CompanionHost, defaultSlug?: string): SceneHostBridge {
  const renderer = host.controller.renderer;
  if (!renderer) {
    throw new Error("CompanionHost has no WebGL renderer");
  }
  return {
    scene: host.controller.scene,
    camera: host.controller.camera,
    renderer,
    getAgentPose: (slug: string): ScenePose | undefined => {
      try {
        const snap = host.controller.getLocomotionSnapshot?.();
        if (snap && Number.isFinite(snap.x) && Number.isFinite(snap.z)) {
          return { x: snap.x, y: 0, z: snap.z, yaw: snap.facing ?? 0 };
        }
        const rig = host.controller.getRig();
        return { x: rig.position.x, y: 0, z: rig.position.z, yaw: rig.rotation.y };
      } catch {
        return undefined;
      }
    },
  };
}

export function createSceneGraphHost(opts: {
  bridge: SceneHostBridge;
  sessionId: string;
  catalog?: ObjectCatalogEntry[];
  allowHosts?: string;
}): SceneGraphHost | null;
/** @deprecated prefer { bridge } */
export function createSceneGraphHost(opts: {
  room: SceneRoom;
  sessionId: string;
  catalog?: ObjectCatalogEntry[];
  allowHosts?: string;
}): SceneGraphHost | null;
export function createSceneGraphHost(opts: {
  bridge?: SceneHostBridge;
  room?: SceneRoom;
  sessionId: string;
  catalog?: ObjectCatalogEntry[];
  allowHosts?: string;
}): SceneGraphHost | null {
  try {
    const bridge = opts.bridge || (opts.room ? bridgeFromSceneRoom(opts.room) : null);
    if (!bridge) return null;

    const graph = new SceneGraph({ authority: "client" });
    const events = new SceneEventLog();
    const pageOrigin = typeof window !== "undefined" ? window.location.origin : undefined;
    const urlPolicy = {
      ...DEFAULT_URL_POLICY,
      externalSources: "allowlist" as const,
      allowHosts: parseAllowHosts(opts.allowHosts || ""),
      pageOrigin,
    };
    const objects = new ObjectSceneLayer({
      catalog: opts.catalog || DEFAULT_CATALOG,
      urlPolicy,
    });
    const robots = new RobotSceneLayer({ urlPolicy });

    bridge.scene.add(objects.group);
    bridge.scene.add(robots.group);

    const transport = new StorageTransport(opts.sessionId, browserStorage());
    restoreGraph(graph, transport);
    const offPersist = attachAutoPersist(graph, transport);

    objects.attach(graph);
    robots.attach(graph);

    const offEvents = graph.subscribe(({ event }) => {
      events.record(event);
    });

    const defaults: ToolsVizDefaults = { ...DEFAULT_TOOLS_VIZ };
    let disposed = false;

    const getAgentPose = (slug: string): ScenePose | undefined => bridge.getAgentPose(slug);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const host: SceneGraphHost = {
      graph,
      events,
      objects,
      robots,
      defaults,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        try {
          offPersist();
          offEvents();
          objects.detach();
          robots.detach();
          bridge.scene.remove(objects.group);
          bridge.scene.remove(robots.group);
        } catch (err) {
          console.warn("[scene-host] dispose error", err);
        }
      },
      tick: () => {
        if (disposed) return;
        objects.tick();
        robots.tick();
      },
      digest: () => (disposed ? [] : graph.digest(32)),
      getAgentPose,
      handleToolEvent: (ev) => {
        if (disposed) return [];
        return handleToolCallEvent(
          {
            graph,
            defaults,
            getAgentPose,
            playEffect: (id, effect) => {
              objects.playEffect(id, effect);
            },
            stopEffect: (id, effect) => {
              objects.stopEffect(id, effect);
            },
          },
          ev,
        );
      },
      setSelected: (id) => {
        if (!disposed) objects.setSelected(id);
      },
      pick: (clientX, clientY) => {
        if (disposed) return null;
        const canvas = bridge.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, bridge.camera);
        return objects.pick(raycaster);
      },
    };
    return host;
  } catch (err) {
    console.warn("[scene-host] failed to init; avatars continue without objects", err);
    return null;
  }
}
