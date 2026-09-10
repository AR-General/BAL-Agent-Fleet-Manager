import { config } from "../config.js";

export interface InstancePorts {
  slot?: number;
  gateway?: number;
  /** Hermes / OpenAI-compatible listen port (alias of gateway when unset). */
  api?: number;
  bridge?: number;
  https?: number;
  bridge_https?: number;
  signal?: number;
  twilio?: number;
  ollama?: number;
}

export interface DefaultUrlsOptions {
  /** When true, gateway_intranet uses https://host:https_port (nginx). */
  gatewayHttps?: boolean;
}

export function portsFromSlot(slot: number): InstancePorts {
  const s = config.portBases.stride * slot;
  const https = config.portBases.https + s;
  return {
    slot,
    gateway: config.portBases.gateway + s,
    bridge: config.portBases.bridge + s,
    https,
    bridge_https: https + 1,
    signal: config.portBases.signal + s,
    twilio: config.portBases.twilio + s,
    ollama: slot === 0 ? config.portBases.ollama + s : undefined,
  };
}

export function slotFromGatewayPort(port: number): number | null {
  const stride = config.portBases.stride;
  if ((port - config.portBases.gateway) % stride !== 0) return null;
  const slot = (port - config.portBases.gateway) / stride;
  return slot >= 0 && slot <= 9 ? slot : null;
}

export function portsFromGatewayPort(port: number, slotFallback = 0): InstancePorts {
  const slot = slotFromGatewayPort(port);
  if (slot !== null) return portsFromSlot(slot);
  const base = portsFromSlot(slotFallback);
  return { ...base, slot: slotFallback, gateway: port };
}

export function defaultUrls(
  host: string,
  ports: InstancePorts,
  opts: DefaultUrlsOptions = {},
): Record<string, string> {
  const h = host.replace(/\/$/, "");
  const httpsPort = ports.https ?? config.portBases.https;
  const bridgeHttps = ports.bridge_https ?? httpsPort + 1;
  const useHttps = opts.gatewayHttps ?? true;

  if (useHttps) {
    return {
      gateway_intranet: `https://${h}:${httpsPort}`,
      control_ui: `https://${h}:${httpsPort}`,
      bridge_api: `https://${h}:${bridgeHttps}`,
      signal_rest: `http://${h}:${ports.signal}`,
      twilio_bridge: `http://${h}:${ports.twilio}`,
    };
  }

  return {
    gateway_intranet: `http://${h}:${ports.gateway}`,
    control_ui: `http://${h}:${ports.https ?? ports.gateway}`,
    bridge_api: `http://${h}:${ports.bridge}`,
    signal_rest: `http://${h}:${ports.signal}`,
    twilio_bridge: `http://${h}:${ports.twilio}`,
  };
}
