export type InstancePorts = {
  slot?: number;
  gateway?: number;
  api?: number;
  bridge?: number;
  https?: number;
  bridge_https?: number;
  signal?: number;
  twilio?: number;
  ollama?: number;
};

export type PortBases = {
  gateway: number;
  bridge: number;
  https: number;
  signal: number;
  twilio: number;
  ollama: number;
  stride: number;
};

export const DEFAULT_PORT_BASES: PortBases = {
  gateway: 18789,
  bridge: 18790,
  https: 8443,
  signal: 8383,
  twilio: 18792,
  ollama: 11434,
  stride: 100,
};

export const EMPTY_PORTS: InstancePorts = {
  slot: 0,
  gateway: 18789,
  bridge: 18790,
  https: 8443,
  bridge_https: 8444,
  signal: 8383,
  twilio: 18792,
  ollama: 11434,
};

export function portsFromSlot(slot: number, bases: PortBases = DEFAULT_PORT_BASES): InstancePorts {
  const s = bases.stride * slot;
  const https = bases.https + s;
  return {
    slot,
    gateway: bases.gateway + s,
    bridge: bases.bridge + s,
    https,
    bridge_https: https + 1,
    signal: bases.signal + s,
    twilio: bases.twilio + s,
    ollama: slot === 0 ? bases.ollama + s : undefined,
  };
}

export function portsToPayload(ports: InstancePorts): InstancePorts {
  const out: InstancePorts = {};
  for (const [k, v] of Object.entries(ports)) {
    if (v !== undefined && v !== null && !Number.isNaN(Number(v))) {
      (out as Record<string, number>)[k] = Number(v);
    }
  }
  return out;
}
