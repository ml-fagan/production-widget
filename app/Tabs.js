"use client";

// Shared tab strip. The schedule stays the front page — the handover queues are
// working lists for Duncan and Alice, not something the whole company reads.

const TABS = [
  { key: "schedule", label: "Production schedule", href: "/" },
  { key: "board", label: "Schedule board", href: "/board" },
  { key: "materials", label: "Material orders", href: "/materials" },
  { key: "stock", label: "Material stock", href: "/material-stock" },
  { key: "invoicing", label: "Invoicing", href: "/invoicing" },
  // A different app, but part of the same flow, so it behaves like the other
  // tabs and navigates in place. Only the reference link opens a new tab.
  {
    key: "handover",
    label: "Handover",
    href: "https://decorhandover.lyphex.com",
    title: "Create or edit a handover",
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
