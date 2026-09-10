import { PortConfigEditor } from "./PortConfigEditor";
import { classifyBotRuntime, RUNTIME_LABELS, type BotRuntimeKind } from "../../lib/botRuntime";
import {
  defaultHealthPath,
  tokenFieldLabel,
  type RuntimeFormValue,
} from "../../lib/instanceRuntimeForm";

type Props = {
  value: RuntimeFormValue;
  onChange: (next: RuntimeFormValue) => void;
  pingSlug?: string;
  tokenPlaceholder?: string;
};

const RUNTIMES: BotRuntimeKind[] = ["openclaw", "hermes", "openai-like"];

export function InstanceRuntimeFields({ value, onChange, pingSlug, tokenPlaceholder }: Props) {
  function set<K extends keyof RuntimeFormValue>(key: K, v: RuntimeFormValue[K]) {
    onChange({ ...value, [key]: v });
  }

  function setRuntime(runtime: BotRuntimeKind) {
    onChange({ ...value, runtime, healthPath: defaultHealthPath(runtime) });
  }

  return (
    <div className="runtime-fields">
      <div className="form-grid">
        <label>
          Runtime *
          <select
            value={value.runtime}
            onChange={(e) => setRuntime(classifyBotRuntime(e.target.value))}
          >
            {RUNTIMES.map((r) => (
              <option key={r} value={r}>
                {RUNTIME_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Display name
          <input value={value.displayName} onChange={(e) => set("displayName", e.target.value)} />
        </label>
        {value.runtime !== "openai-like" ? (
          <label>
            Host
            <input
              value={value.host}
              onChange={(e) => set("host", e.target.value)}
              placeholder="127.0.0.1"
            />
          </label>
        ) : null}
        <label>
          Fallback host
          <input
            value={value.fallbackHost}
            onChange={(e) => set("fallbackHost", e.target.value)}
            placeholder="optional"
          />
        </label>
        <label className="full">
          {tokenFieldLabel(value.runtime)}
          <input
            type="password"
            autoComplete="off"
            value={value.gatewayToken}
            placeholder={tokenPlaceholder}
            onChange={(e) => set("gatewayToken", e.target.value)}
          />
        </label>
      </div>

      {value.runtime === "openclaw" ? (
        <PortConfigEditor
          host={value.host}
          ports={value.ports}
          urls={value.urls}
          tls={value.tls}
          onHostChange={(host) => set("host", host)}
          onPortsChange={(ports) => set("ports", ports)}
          onUrlsChange={(urls) => set("urls", urls)}
          onTlsChange={(tls) => set("tls", tls)}
          pingSlug={pingSlug}
        />
      ) : null}

      {value.runtime === "hermes" ? (
        <div className="form-grid" style={{ marginTop: "1rem" }}>
          <label>
            API port
            <input
              type="number"
              min={1}
              max={65535}
              value={value.apiPort}
              onChange={(e) => set("apiPort", Number(e.target.value) || 0)}
            />
          </label>
          <label>
            HTTPS / control UI port
            <input
              type="number"
              min={1}
              max={65535}
              value={value.httpsPort}
              onChange={(e) => set("httpsPort", Number(e.target.value) || 0)}
            />
          </label>
          <label>
            Health path
            <input
              value={value.healthPath || defaultHealthPath("hermes")}
              onChange={(e) => set("healthPath", e.target.value)}
            />
          </label>
          <label>
            Default model
            <input
              value={value.defaultModel}
              onChange={(e) => set("defaultModel", e.target.value)}
              placeholder="default"
            />
          </label>
        </div>
      ) : null}

      {value.runtime === "openai-like" ? (
        <div className="form-grid" style={{ marginTop: "1rem" }}>
          <label className="full">
            API base (OpenAI-compatible)
            <input
              required
              value={value.apiBase}
              onChange={(e) => set("apiBase", e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <label>
            Default model
            <input
              value={value.defaultModel}
              onChange={(e) => set("defaultModel", e.target.value)}
              placeholder="gpt-4o-mini"
            />
          </label>
          <label>
            Health path
            <input
              value={value.healthPath || defaultHealthPath("openai-like")}
              onChange={(e) => set("healthPath", e.target.value)}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
