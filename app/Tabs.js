"use client";

// Shared tab strip, in four groups.
//
// The boards clustered by themselves as they were built — two about the day's
// production, two about material, two about the warehouse — and by nine of
// them the row had no order to it at all. Grouping them puts each person's
// working set together and everything else out of the way.
//
// Deliberately still ONE row of tabs rather than categories with a second row
// under them. Two of these boards already carry their own sub-tabs: Stock has
// On hand / Tracking / Factory layout, Material orders has five. A category
// row above those would be three rows of navigation before the first number on
// the page, and the middle one would be doing the least work of the three.
//
// The production schedule isn't on the strip at all. It's read from Jordan's
// spreadsheet, nobody acts on it, and it sat first in a row of things people
// act on. It's the company overview, so it reads as one — a quiet link, beside
// the other things that aren't the work.

const GROUPS = [
  { key: "production", label: "Production" },
  { key: "material", label: "Material" },
  { key: "warehouse", label: "Warehouse" },
  { key: "money", label: "Money" },
];

const TABS = [
  {
    key: "board",
    label: "Schedule board",
    href: "/board",
    group: "production",
    title: "Dates, priority and where each job is up to",
  },
  {
    key: "allocation",
    label: "Allocation",
    href: "/allocation",
    group: "production",
    title: "Who's on which step today",
  },
  {
    key: "materials",
    // Short inside a group: "Material orders" under a heading that already
    // says Material is the same word twice.
    label: "Orders",
    href: "/materials",
    group: "material",
    title: "What to order, from whom, and what's still coming",
  },
  {
    key: "materiallist",
    label: "List",
    href: "/material-list",
    group: "material",
    title: "Every finish we buy, and who supplies it — what everything else picks from",
  },
  {
    key: "warehouse",
    label: "Deliveries",
    href: "/warehouse",
    group: "warehouse",
    title: "Deliveries expected — tick one off as it comes through the door",
  },
  {
    // Alice keeps it, but most of what happens to it happens on the floor:
    // counting bays, putting material on racks, adding stock where it sits.
    key: "stock",
    label: "Stock",
    href: "/material-stock",
    group: "warehouse",
    title: "What's on the racks, where it is, and what's spoken for",
  },
  { key: "invoicing", label: "Invoicing", href: "/invoicing", group: "money" },

  // Below the line, off to the side: the things that aren't the day's work. A
  // folder tab says "a place your job takes you"; these aren't that.
  {
    key: "schedule",
    label: "Overview",
    href: "/",
    quiet: true,
    title: "The whole factory's schedule, live from SharePoint — read-only",
  },
  {
    key: "handover",
    label: "Handover",
    href: "https://decorhandover.lyphex.com",
    external: true,
    quiet: true,
    title: "Create or edit a handover — opens the handover app",
  },
  {
    key: "requests",
    label: "Request a change",
    href: "/requests",
    quiet: true,
    title: "Ask for something these screens don't do yet",
  },
  // Reference tool, not part of this app — opens in a new tab so nobody loses
  // their place. Never renders active, since no page passes this key.
  //
  // `always` because it isn't ours to gate: published acoustic data anyone can
  // read, and the only link that bypasses the role list.
  {
    key: "acoustics",
    label: "Acoustic data",
    href: "https://acoustics.lyphex.com",
    external: true,
    always: true,
    quiet: true,
    title: "Tested NRC and absorption coefficients — opens in a new tab",
  },
];

function Tab({ tab, active, count }) {
  return (
    <a
      href={tab.href}
      target={tab.external ? "_blank" : undefined}
      rel={tab.external ? "noreferrer" : undefined}
      title={tab.title}
      style={{
        fontSize: 13,
        textDecoration: "none",
        whiteSpace: "nowrap",
        padding: active ? "9px 14px 8px" : "7px 13px 6px",
        borderLeft: "1px solid #e5e1d8",
        borderRight: "1px solid #e5e1d8",
        borderRadius: "8px 8px 0 0",
        marginBottom: -1,
        color: active ? "#1c1b19" : "#6b6862",
        fontWeight: active ? 600 : 400,
        // The open tab is the page's own colour and covers the line; the closed
        // ones are tinted, sit a little lower and keep their bottom edge, so
        // they read as behind it.
        background: active ? "#f5f3ef" : "#eceae4",
        borderBottom: active ? "1px solid #f5f3ef" : "1px solid #e5e1d8",
        borderTop: active ? "2px solid #408152" : "1px solid #e5e1d8",
      }}
    >
      {tab.label}
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
}

export default function Tabs({ current, counts = {}, tabs = null }) {
  // A board this person can't use is a board in the way. The floor gets the
  // two schedules; everyone else gets the lot.
  // Filtered on the role's own list. `external` is about where a link opens,
  // not about who may see it — the two were the same test until the handover
  // app moved to this line, which quietly showed it to the floor. Only the
  // acoustic reference is exempt, and it says so.
  const visible = tabs ? TABS.filter((t) => tabs.includes(t.key) || t.always) : TABS;
  const quiet = visible.filter((t) => t.quiet);
  const groups = GROUPS.map((g) => ({
    ...g,
    tabs: visible.filter((t) => t.group === g.key),
  })).filter((g) => g.tabs.length > 0);

  return (
    <nav
      style={{
        display: "flex",
        alignItems: "flex-end",
        // The gap between groups is what does the grouping — wider than the
        // gap between tabs inside one, and that's the whole mechanism.
        gap: 20,
        marginBottom: 16,
        // The line every tab sits on. The one you're looking at breaks it,
        // which is the trick: its own bottom edge is painted in the page colour
        // over this, so it reads as the open folder rather than one behind it.
        borderBottom: "1px solid #e5e1d8",
        flexWrap: "wrap",
      }}
    >
      {groups.map((group) => (
        <div key={group.key} style={{ display: "flex", flexDirection: "column" }}>
          <span
            style={{
              fontSize: 9,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: "#9c988f",
              marginBottom: 3,
              paddingLeft: 3,
            }}
          >
            {group.label}
          </span>
          <div style={{ display: "flex", gap: 3, alignItems: "flex-end" }}>
            {group.tabs.map((tab) => (
              <Tab
                key={tab.key}
                tab={tab}
                active={tab.key === current}
                count={counts[tab.key]}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Pushed to the far end and wrapping under on a narrow screen. Plain
          links, because none of them is a place the day's work happens. */}
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          gap: 14,
          alignItems: "baseline",
          padding: "8px 0",
        }}
      >
        {quiet.map((tab) => {
          const active = tab.key === current;
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
                color: active ? "#1c1b19" : "#6b6862",
                fontWeight: active ? 600 : 400,
              }}
            >
              {tab.label}
              {tab.external && (
                <span aria-hidden="true" style={{ marginLeft: 5, fontSize: 11, opacity: 0.7 }}>
                  ↗
                </span>
              )}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
