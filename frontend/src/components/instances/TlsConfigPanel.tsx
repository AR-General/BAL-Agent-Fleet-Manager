import type { InstanceTls } from "../../types/tls";
import { normalizeTls, tlsSelfSignedWarning } from "../../types/tls";

type Props = {
  tls: InstanceTls;
  onChange: (tls: InstanceTls) => void;
};

export function TlsConfigPanel({ tls, onChange }: Props) {
  const normalized = normalizeTls(tls);
  const warning = tlsSelfSignedWarning(normalized);

  return (
    <div className="tls-config">
      <h4>TLS / HTTPS</h4>
      <p className="muted">
        Fleet instances behind nginx use HTTPS on the <strong>HTTPS port</strong> (not the internal gateway
        port). Enable self-signed only for auto-generated certs in <code>nginx/ssl/</code>.
      </p>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={normalized.gateway_https}
          onChange={(e) => onChange({ ...tls, gateway_https: e.target.checked })}
        />
        Use HTTPS for gateway health URL (<code>gateway_intranet</code>)
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={normalized.allow_self_signed}
          onChange={(e) => onChange({ ...tls, allow_self_signed: e.target.checked })}
        />
        Allow self-signed / untrusted TLS certificates
      </label>

      {warning && (
        <div className="alert-warn" role="status">
          <strong>Security notice</strong>
          <p>{warning}</p>
        </div>
      )}
    </div>
  );
}
