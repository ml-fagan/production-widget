"use client";

// Shared tab strip. The schedule stays the front page — the handover queues are
// working lists for Duncan and Alice, not something the whole company reads.

const TABS = [
  { key: "schedule", label: "Production schedule", href: "/" },
  { key: "board", label: "Schedule board", href: "/board" },
  { key: "materials", label: "Material orders", href: "/materials" },
  {
    key: "warehouse",
    label: "Warehouse",
    href: "/warehouse",
    title: "Deliveries expected — tick one off as it comes through the door",
  },
  { key: "stock", label: "Stock", href: "/material-stock" },
  {
    key: "materiallist",
    label: "Material list",
    href: "/material-list",
    title: "Every finish we buy, and who supplies it — what everything else picks from",
  },
  { key: "invoicing", label: "Invoicing", href: "/invoicing" },
  // A different app, but part of the same flow, so it behaves like the other
  // tabs and navigates in place. Only the reference link opens a new tab.
  {
    key: "handover",
    label: "Handover",
    href: "https://decorhandover.lyphex.com",
    title: "Create or edit a handover",
  },
  // Below the line, off to the side: the two things that aren't the work. A
  // folder tab says "a place your job takes you"; these aren't that. Requests
  // is about the app itself, so it sits with the reference link rather than
  // among the boards, where it would read as another thing to check.
  {
    key: "requests",
    label: "Request a change",
    href: "/requests",
    quiet: true,
    title: "Ask for something these screens don't do yet",
  },
  // Reference tool, not part of this app — opens in a new tab so nobody loses
  // their place in the schedule. Never renders active, since no page passes this key.
  {
    key: "acoustics",
    label: "Acoustic data",
    href: "https://acoustics.lyphex.com",
    external: true,
    quiet: true,
    title: "Tested NRC and absorption coefficients — opens in a new tab",
  },
];

export default function Tabs({ current, counts = {}, tabs = null }) {
  // A board this person can't use is a board in the way. The floor gets the
  // two schedules; everyone else gets the lot.
  const visible = tabs ? TABS.filter((t) => tabs.includes(t.key) || t.external) : TABS;
  // Only the first of the quiet links gets pushed to the far end; the rest
  // follow it. Two "auto" margins would leave the first one hogging the space.
  const firstQuiet = visible.findIndex((t) => t.quiet);
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 3,
        marginBottom: 16,
        // The line every tab sits on. The one you're looking at breaks it,
        // which is the whole trick: its own bottom edge is painted in the page
        // colour over this, so it reads as the open folder rather than one of
        // the closed ones behind it.
        borderBottom: "1px solid #e5e1d8",
        flexWrap: "wrap",
      }}
    >
      {visible.map((tab, i) => {
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
              textDecoration: "none",
              whiteSpace: "nowrap",
              // The quiet links aren't boards, so they stay plain links rather
              // than growing folder tabs. The one you're on just darkens.
              ...(tab.quiet
                ? {
                    padding: "8px 4px",
                    marginLeft: i === firstQuiet ? "auto" : 12,
                    color: active ? "#1c1b19" : "#6b6862",
                    fontWeight: active ? 600 : 400,
                  }
                : {
                    padding: active ? "9px 14px 8px" : "7px 13px 6px",
                    border: "1px solid #e5e1d8",
                    borderRadius: "8px 8px 0 0",
                    marginBottom: -1,
                    color: active ? "#1c1b19" : "#6b6862",
                    fontWeight: active ? 600 : 400,
                    // The open tab is the page's own colour and covers the
                    // line; the closed ones are tinted, sit a little lower and
                    // keep their bottom edge, so they read as behind it.
                    background: active ? "#f5f3ef" : "#eceae4",
                    borderBottom: active ? "1px solid #f5f3ef" : "1px solid #e5e1d8",
                    borderTop: active ? "2px solid #408152" : "1px solid #e5e1d8",
                  }),
            }}
          >
            {tab.label}
            {tab.external && (
              <span aria-hidden="true" style={{ marginLeft: 5, fontSize: 11, opacity: 0.7 }}>
                ↗
              </span>
            )}
            {/* A count belongs on work. The quiet links aren't work, so they
                don't get to nag. */}
            {count > 0 && !tab.quiet && (
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
