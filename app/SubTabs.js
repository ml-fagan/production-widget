"use client";

// The second and third levels of navigation, in one place.
//
// The first level is Tabs.js: folder tabs in four groups, which is "where in
// the company am I". Below that, most boards split again — Stock into On hand
// / Tracking / Factory layout, Material orders into five, Invoicing into
// three — and every one of those had been written out by hand where it was
// needed. Six pages, four different appearances: a grey capsule on two, an
// underline rule on two, solid ink pills on one, and bold-vs-grey text on
// another. Nothing was wrong with any of them on its own; together they meant
// the same click looked like four different kinds of thing depending on which
// board you'd opened.
//
// So there are exactly two levels under the tabs, and they are not
// interchangeable:
//
//   level 2 — a segmented capsule. One board, several views of it. The
//             capsule is a single object with a piece of it lit, which is
//             what switching views is.
//   level 3 — an underline rule. A cut within the view you're already in,
//             like Tracking's by-project or by-material. Lighter than the
//             capsule, because it is a smaller decision.
//
// Depth reads the same on every board now: capsule then rule, never rule then
// capsule, and never a rule at level 2 on one page and a capsule at level 2 on
// the next.

const LINE = "#e5e1d8";
const INK = "#1c1b19";
const SUB = "#6b6862";
const FADE = "#9c988f";
const TRAY = "#efece5";

/**
 * A count beside a label.
 *
 * Plain and muted by default: on most of these the number is context, not a
 * summons. `tone: "warn"` is for the ones that are — orders going past their
 * chase date, and nothing else — and gets the red chip, so that red keeps
 * meaning one thing across the whole app.
 */
function Count({ value, tone, active }) {
  if (!value) return null;
  if (tone === "warn") {
    return (
      <span
        style={{
          marginLeft: 6,
          fontSize: 11,
          background: "#f6dcd9",
          color: "#a3312c",
          borderRadius: 10,
          padding: "1px 7px",
        }}
      >
        {value}
      </span>
    );
  }
  return (
    <span style={{ marginLeft: 6, fontSize: 12, color: active ? SUB : FADE, fontWeight: 400 }}>
      {value}
    </span>
  );
}

export default function SubTabs({ items, current, onChange, level = 2 }) {
  const shown = items.filter(Boolean);
  if (shown.length < 2) return null;

  if (level === 3) {
    return (
      <div
        style={{
          display: "flex",
          gap: 18,
          marginBottom: 14,
          borderBottom: `1px solid ${LINE}`,
          flexWrap: "wrap",
        }}
      >
        {shown.map((item) => {
          const active = item.key === current;
          return (
            <button
              key={item.key}
              onClick={() => onChange(item.key)}
              title={item.title}
              style={{
                border: "none",
                borderBottom: `2px solid ${active ? SUB : "transparent"}`,
                background: "none",
                color: active ? INK : FADE,
                fontWeight: active ? 600 : 400,
                fontSize: 12,
                padding: "0 0 7px",
                marginBottom: -1,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {item.label}
              <Count value={item.count} tone={item.tone} active={active} />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "inline-flex",
        background: TRAY,
        borderRadius: 10,
        padding: 3,
        marginBottom: 16,
        flexWrap: "wrap",
      }}
    >
      {shown.map((item) => {
        const active = item.key === current;
        return (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            title={item.title}
            style={{
              border: "none",
              background: active ? "#fff" : "transparent",
              color: active ? INK : SUB,
              fontWeight: active ? 600 : 500,
              fontSize: 13,
              padding: "7px 16px",
              borderRadius: 8,
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
              // The lit segment sits proud of the tray; the rest are the tray.
              boxShadow: active ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
            }}
          >
            {item.label}
            <Count value={item.count} tone={item.tone} active={active} />
          </button>
        );
      })}
    </div>
  );
}
