"use client";

// Shared tab strip. The schedule stays the front page — the handover queues are
// working lists for Duncan and Alice, not something the whole company reads.

const TABS = [
  { key: "schedule", label: "Production schedule", href: "/" },
  { key: "board", label: "Schedule board", href: "/board" },
  { key: "materials", label: "Material orders", href: "/materials" },
  // Where a job starts. Its own app, so it opens in a new tab — but it sits
  // inline with the rest because it's part of the same flow, not a reference.
  {
    key: "handover",
    label: "Handover",
    href: "https://decorhandover.lyphex.com",
    external: true,
    title: "Create or edit a handover — opens in a new tab",
  },
  // Reference tool, not part of this app — opens in a new tab so nobody loses
  // their place in the schedule. Never renders active, since no page passes this key.
  {
    key: "acoustics",
    label: "Acoustic data",
    href: "https://acoustics.lyphex.com",
    external: true,
    rightAligned: true,
    title: "Tested NRC and absorption coefficients — opens in a new tab",
  },
];

export default function Tabs({ current, counts = {} }) {
  return (
    <nav
      style={{
        display: "flex",
        gap: 4,
        marginBottom: 16,
        borderBottom: "1px solid #e5e1d8",
        flexWrap: "wrap",
      }}
    >
      {TABS.map((tab) => {
        const active = tab.key === current;
        const count = counts[tab.key];
        return (
          <a
            key={tab.key}
            href={tab.href}
            target={tab.external ? "_blank" : undefined}
            rel={tab.external ? "noreferrer" : undefined}
            title={tab.title}
            style={{
              fontSize: 13,
              padding: "8px 12px",
              textDecoration: "none",
              color: active ? "#1c1b19" : "#6b6862",
              fontWeight: active ? 600 : 400,
              borderBottom: active ? "2px solid #408152" : "2px solid transparent",
              marginBottom: -1,
              // Only the reference link is pushed to the far end; two "auto"
              // margins would leave the first one hogging all the space.
              marginLeft: tab.rightAligned ? "auto" : undefined,
            }}
          >
            {tab.label}
            {tab.external && (
              <span aria-hidden="true" style={{ marginLeft: 5, fontSize: 11, opacity: 0.7 }}>
                ↗
              </span>
            )}
            {count > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  background: "#efece5",
                  color: "#6b6862",
                  borderRadius: 10,
                  padding: "1px 7px",
                }}
              >
                {count}
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );
}
