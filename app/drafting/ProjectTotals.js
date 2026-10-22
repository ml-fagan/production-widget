"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Where the work is, across the whole company.
 *
 * The chart beside this one is about rows somebody has to chase: drawings
 * sitting with a client and accounts nobody has rung. This is a different
 * question — how much is in each department at all — and it reaches past
 * the two projects that board reads into Production, Estimating, defects and
 * the job tracker.
 *
 * Counts only. Nothing here opens, because the rows behind it aren't on this
 * board: a Production task is Duncan's and an estimate is Mitch's, and a
 * chart that pretended to drill into them would be offering to show rows it
 * has never read. The link goes to Asana instead, which is where that work
 * actually lives.
 *
 * Horizontal bars, because the labels are words rather than names and the
 * magnitudes are nothing alike — All Jobs runs to three hundred where
 * external drawings is eight. Laid out vertically that smallest bar is two
 * pixels under a label turned on its side; laid out across, it is a short
 * bar with its number beside it, which still reads.
 *
 * The scale is linear and deliberately so. Estimating with its completed
 * quotes counted is nearly four thousand against everything else's hundreds,
 * and a log scale would hide exactly that — the honest answer is that the bar
 * runs off the end, and the switch that put it there is one click away.
 */

const STORE = "decor.projectTotals.v1";

/** Soft neutrals from the same family the rest of the boards use. */
const BAR = "#b7af9c";
const BAR_DONE = "#d8d2c4";

export default function ProjectTotals({ projects, brand, syncedAt }) {
  /**
   * Which projects to show, and whether to count completed on each.
   *
   * Per person and kept in the browser: it is a preference about a view, not
   * a fact about the company, and putting it in Firestore would mean a write
   * every time somebody ticked a box and an argument the first time two
   * people wanted different charts.
   */
  const [prefs, setPrefs] = useState(null);
  const [open, setOpen] = useState(false);

  // Defaults come from the register, so a project added there appears here
  // without anybody clearing their saved settings.
  const fallback = useMemo(() => {
    const out = {};
    for (const p of projects ?? []) {
      out[p.gid] = { show: true, completed: Boolean(p.completedByDefault) };
    }
    return out;
  }, [projects]);

  useEffect(() => {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORE) || "{}");
    } catch {
      // A corrupt or blocked store just means defaults, which is fine.
    }
    const merged = {};
    for (const p of projects ?? []) {
      merged[p.gid] = {
        show: saved[p.gid]?.show ?? fallback[p.gid]?.show ?? true,
        completed: saved[p.gid]?.completed ?? fallback[p.gid]?.completed ?? false,
      };
    }
    setPrefs(merged);
  }, [projects, fallback]);

  const update = (gid, patch) =>
    setPrefs((p) => {
      const next = { ...p, [gid]: { ...p[gid], ...patch } };
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        // Private browsing — the chart still works, it just won't remember.
      }
      return next;
    });

  // Null until the saved settings have been read, so the chart doesn't flash
  // the defaults and then rearrange itself.
  if (!prefs) return null;

  const rows = (projects ?? [])
    .filter((p) => prefs[p.gid]?.show)
    .map((p) => {
      const withDone = Boolean(prefs[p.gid]?.completed);
      return {
        ...p,
        withDone,
        shown: p.open + (withDone ? p.completed : 0),
      };
    })
    .sort((a, b) => b.shown - a.shown);

  const max = Math.max(1, ...rows.map((r) => r.shown));
  const total = rows.reduce((t, r) => t + r.shown, 0);
  const hidden = (projects ?? []).length - rows.length;

  const box = {
    background: brand.card,
    border: `1px solid ${brand.line}`,
    borderRadius: 10,
    padding: "14px 16px 16px",
    marginBottom: 14,
    flex: "1 1 420px",
    minWidth: 320,
    alignSelf: "flex-start",
  };

  return (
    <section style={box}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
        <strong style={{ fontSize: 14, fontWeight: 600 }}>Across the projects</strong>
        <span style={{ fontSize: 12, color: brand.sub, marginRight: "auto" }}>
          {total} {total === 1 ? "task" : "tasks"} in {rows.length}{" "}
          {rows.length === 1 ? "project" : "projects"}
          {hidden > 0 ? ` · ${hidden} hidden` : ""}
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            border: `1px solid ${open ? brand.ink : brand.line}`,
            background: open ? brand.ink : brand.card,
            color: open ? "#fff" : brand.sub,
            borderRadius: 8,
            padding: "5px 12px",
            fontSize: 12,
            cursor: "pointer",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          Choose
        </button>
      </div>

      {open && (
        <div
          style={{
            border: `1px solid ${brand.line}`,
            borderRadius: 8,
            padding: "8px 10px",
            marginBottom: 14,
            background: "#faf9f6",
          }}
        >
          <div style={{ fontSize: 11, color: brand.sub, marginBottom: 6 }}>
            Which projects to count, and whether to include tasks that have been
            ticked complete. On Drawings, complete means issued and sitting with
            the client — which is why it starts on there and nowhere else.
          </div>
          {(projects ?? []).map((p) => (
            <div
              key={p.gid}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "3px 0",
                fontSize: 12,
              }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean(prefs[p.gid]?.show)}
                  onChange={(e) => update(p.gid, { show: e.target.checked })}
                />
                <span style={{ color: prefs[p.gid]?.show ? brand.ink : brand.sub }}>{p.label}</span>
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  color: brand.sub,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
                title={`${p.completed} completed · ${p.open} open`}
              >
                <input
                  type="checkbox"
                  checked={Boolean(prefs[p.gid]?.completed)}
                  onChange={(e) => update(p.gid, { completed: e.target.checked })}
                />
                include completed
                <span style={{ color: "#b3afa6" }}>({p.completed})</span>
              </label>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: brand.sub, margin: 0 }}>
          Nothing chosen — press Choose and tick a project.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {rows.map((r) => (
            <div key={r.gid} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: 118,
                  flexShrink: 0,
                  fontSize: 12,
                  color: brand.ink,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={r.label}
              >
                {r.label}
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 16,
                    background: "#f1eee8",
                    borderRadius: 3,
                    overflow: "hidden",
                    display: "flex",
                  }}
                >
                  {/* Open and completed as two pieces of one bar, so a project
                      counting both still says how much of it is finished. */}
                  <div
                    style={{ width: `${(r.open / max) * 100}%`, background: BAR }}
                    title={`${r.open} open`}
                  />
                  {r.withDone && (
                    <div
                      style={{
                        width: `${(r.completed / max) * 100}%`,
                        background: BAR_DONE,
                      }}
                      title={`${r.completed} completed`}
                    />
                  )}
                </div>
                <span
                  style={{
                    width: 44,
                    textAlign: "right",
                    fontSize: 12,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                    color: brand.ink,
                  }}
                >
                  {r.shown}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 11, color: brand.sub }}>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 9,
              height: 9,
              background: BAR,
              borderRadius: 2,
              marginRight: 4,
            }}
          />
          Open
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 9,
              height: 9,
              background: BAR_DONE,
              borderRadius: 2,
              marginRight: 4,
            }}
          />
          Completed, where it's counted
        </span>
        {/* Top-level tasks only, said plainly: a job with eight deliveries
            under it counts once, not nine. */}
        <span style={{ marginLeft: "auto", color: "#b3afa6" }}>
          Tasks in the project, not their subtasks
        </span>
      </div>
    </section>
  );
}
