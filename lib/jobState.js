// How a job state reads on screen, and what colour it carries.
//
// The state itself is worked out in the handover app and arrives on every row,
// so nothing here decides anything — this is only how it looks. Keeping the
// wording in one place stops "Despatched" on one board and "Complete" on the
// next from sounding like two different things.

export const JOB_STATE_LABELS = {
  draft: "Draft",
  awaiting_schedule: "Awaiting schedule",
  scheduled: "Scheduled",
  in_production: "In production",
  despatched: "Despatched",
  invoiced: "Invoiced",
  closed: "Closed",
};

// Only despatched is coloured, and deliberately: it's the one state that means
// somebody has to do something. The rest are just where the job is.
const TONE = {
  despatched: { bg: "#f6e7c8", fg: "#7a5310" },
  closed: { bg: "#e3ece4", fg: "#2f5d3c" },
};

export function JobStateBadge({ state, title }) {
  const tone = TONE[state];
  return (
    <span
      title={title}
      style={{
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 4,
        whiteSpace: "nowrap",
        background: tone ? tone.bg : "transparent",
        color: tone ? tone.fg : "#6b6862",
        border: tone ? "none" : "1px solid #e5e1d8",
      }}
    >
      {JOB_STATE_LABELS[state] || state}
    </span>
  );
}
