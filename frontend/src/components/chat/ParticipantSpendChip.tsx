import { useState } from "react";
import { formatTokenCount, formatUsd, type SessionTokenSpend } from "../../lib/tokenSpend";

type Props = {
  spend: SessionTokenSpend;
  participantSlugs: string[];
};

export function ParticipantSpendChip({ spend, participantSlugs }: Props) {
  const [open, setOpen] = useState(false);
  const rows = participantSlugs.map((slug) => {
    const row = spend.participants.find((p) => p.slug === slug);
    return (
      row || {
        slug,
        usd: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        calls: 0,
        estimated: false,
      }
    );
  });
  const extras = spend.participants.filter((p) => !participantSlugs.includes(p.slug));
  const tableRows = [...rows, ...extras];

  return (
    <span
      className={`chat-participant-spend ${open ? "open" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        className="chat-participant-spend-btn"
        title="Token spend this session"
        aria-label={`Session spend ${formatUsd(spend.total_usd)}`}
        onClick={() => setOpen(true)}
      >
        {formatUsd(spend.total_usd)}
        {spend.estimated ? <span className="muted"> est.</span> : null}
      </button>
      {open ? (
        <div className="chat-participant-spend-tip" role="tooltip">
          <table className="chat-participant-spend-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Calls</th>
                <th>In</th>
                <th>Out</th>
                <th>$</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.slug}>
                  <td>@{row.slug}</td>
                  <td>{row.calls}</td>
                  <td>{formatTokenCount(row.prompt_tokens)}</td>
                  <td>{formatTokenCount(row.completion_tokens)}</td>
                  <td>{formatUsd(row.usd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td>{spend.participants.reduce((n, p) => n + p.calls, 0)}</td>
                <td>{formatTokenCount(spend.total_prompt_tokens)}</td>
                <td>{formatTokenCount(spend.total_completion_tokens)}</td>
                <td>{formatUsd(spend.total_usd)}</td>
              </tr>
            </tfoot>
          </table>
          {spend.estimated ? <p className="muted">Some costs are estimated from token counts.</p> : null}
        </div>
      ) : null}
    </span>
  );
}
