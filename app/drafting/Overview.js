"use client";

import { useMemo, useState } from "react";
import {
  CHASE_BANDS,
  CHASE_FILTERS,
  filterByKey,
  overviewFor,
  selectRows,
  clockFrom,
  isAccount,
  shortDay,
} from "../../lib/drafting.js";

/**
 * Who is carrying what, and how late it is.
 *
 * One bar per person, stacked by how long since anybody was in touch. The
 * height answers "how much is on them"; the darkness answers "how much of it
 * has gone quiet". Both at once, because either on its own is misleading —
 * ninety-two rows is only alarming if they are old, and one row at a hundred
 * days is worse than forty fresh ones.
 *
 * The colour never says who. Names are nominal, so every bar uses the same
 * ramp; a per-person palette would be eight hues encoding nothing, and the
 * one thing worth seeing would be gone.
 *
 * Every piece of it opens. A bar segment is a question — "what are Veronica's
 * thirty past four weeks?" — and a chart that can't answer it just sends you
 * somewhere else to look.
 */

const PLOT = { w: 860, h: 300, left: 42, right: 14, top: 18, bottom: 54 };

/** Nice round gridlines rather than whatever the maximum happens to be. */
function ticksFor(max) {
  if (max <= 0) return { top: 1, step: 1 };
  const rough = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? mag * 10;
  return { top: Math.ceil(max / step) * step, step };
}

export default function Overview({ rows, now, brand, onPickPerson }) {
  const [filterKey, setFilterKey] = useState("all");
  const [hover, setHover] = useState(null);
  // What's open underneath: a person, or a person and one band of their bar.
  const [picked, setPicked] = useState(null);

  const filter = filterByKey(filterKey);
  const data = useMemo(() => overviewFor(rows, now, filter), [rows, now, filter]);
  const shown = data.filter((d) => d.total > 0);
  const max = Math.max(1, ...shown.map((d) => d.total));
  const { top, step } = ticksFor(max);

  const innerW = PLOT.w - PLOT.left - PLOT.right;
  const innerH = PLOT.h - PLOT.top - PLOT.bottom;
  const slot = shown.length ? innerW / shown.length : innerW;
  const barW = Math.min(64, Math.max(18, slot * 0.52));
  const y = (v) => PLOT.top + innerH - (v / top) * innerH;

  const gridlines = [];
  for (let v = 0; v <= top + 0.001; v += step) gridlines.push(v);

  const total = shown.reduce((a, d) => a + d.total, 0);

  const open = useMemo(
    () => (picked ? selectRows(rows, now, { filter, who: picked.who, band: picked.band }) : []),
    [picked, rows, now, filter]
  );
  const bandLabel = (key) => CHASE_BANDS.find((b) => b.key === key)?.label ?? "";

  const toggle = (who, band) =>
    setPicked((p) => (p && p.who === who && p.band === band ? null : { who, band }));

  const btn = {
    border: `1px solid ${brand.line}`,
    background: brand.card,
    color: brand.sub,
    borderRadius: 8,
    padding: "5px 12px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  };
  const th = {
    textAlign: "left",
    fontSize: 11,
    fontWeight: 500,
    color: brand.sub,
    padding: "6px 10px",
    borderBottom: `1px solid ${brand.line}`,
  };
  const td = {
    fontSize: 12,
    padding: "6px 10px",
    borderBottom: `1px solid ${brand.line}`,
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <section
      style={{
        background: brand.card,
        border: `1px solid ${brand.line}`,
        borderRadius: 10,
        padding: "14px 16px 18px",
        marginBottom: 14,
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <strong style={{ fontSize: 14, fontWeight: 600 }}>Who is carrying what</strong>
        <span style={{ fontSize: 12, color: brand.sub, marginRight: "auto" }}>
          {total} {total === 1 ? "task" : "tasks"} · click a bar or a name to open it
        </span>
        {CHASE_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setFilterKey(f.key);
              setPicked(null);
            }}
            title={
              f.key === "all"
                ? "Every task on the board"
                : f.key === "within"
                  ? "Touched in the last fortnight — nothing to chase"
                  : "Nobody has touched these in a fortnight or more"
            }
            style={{
              ...btn,
              background: filterKey === f.key ? brand.ink : brand.card,
              borderColor: filterKey === f.key ? brand.ink : brand.line,
              color: filterKey === f.key ? "#fff" : brand.sub,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p style={{ fontSize: 13, color: brand.sub, margin: "20px 0" }}>
          Nothing in that range. That is the good answer.
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${PLOT.w} ${PLOT.h}`}
            width="100%"
            role="img"
            aria-label={`Tasks per person, ${filter.label}`}
            style={{ display: "block", overflow: "visible" }}
          >
            {gridlines.map((v) => (
              <g key={v}>
                <line
                  x1={PLOT.left}
                  x2={PLOT.w - PLOT.right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke={v === 0 ? brand.line : "#f0ede6"}
                  strokeWidth={1}
                />
                <text x={PLOT.left - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill={brand.sub}>
                  {v}
                </text>
              </g>
            ))}

            {shown.map((d, i) => {
              const cx = PLOT.left + slot * i + slot / 2;
              const x = cx - barW / 2;
              let cursor = 0;
              // Darkest on the baseline, where it can be compared across bars
              // rather than floating at a different height in every column.
              const order = [...CHASE_BANDS].reverse();
              const isPickedPerson = picked && picked.who === d.who;
              return (
                <g key={d.who}>
                  {order.map((band) => {
                    const n = d.bands[band.key] || 0;
                    if (!n) return null;
                    const h = (n / top) * innerH;
                    const yTop = PLOT.top + innerH - cursor - h;
                    cursor += h;
                    const isTop = cursor >= (d.total / top) * innerH - 0.5;
                    const isPicked = isPickedPerson && picked.band === band.key;
                    const dim = (hover && !(hover.who === d.who && hover.band === band.key)) ||
                      (picked && !isPicked);
                    return (
                      <rect
                        key={band.key}
                        x={x}
                        y={yTop}
                        width={barW}
                        height={Math.max(1, h - 2)}
                        rx={isTop ? 4 : 0}
                        fill={band.color}
                        opacity={dim ? 0.4 : 1}
                        stroke={isPicked ? brand.ink : "none"}
                        strokeWidth={isPicked ? 2 : 0}
                        onMouseEnter={() =>
                          setHover({ who: d.who, band: band.key, n, total: d.total, worst: d.worst })
                        }
                        onMouseLeave={() => setHover(null)}
                        onClick={() => toggle(d.who, band.key)}
                        style={{ cursor: "pointer" }}
                      >
                        <title>{`${d.who} — ${n} ${band.label.toLowerCase()}`}</title>
                      </rect>
                    );
                  })}
                  <text x={cx} y={y(d.total) - 7} textAnchor="middle" fontSize={12} fontWeight={600} fill={brand.ink}>
                    {d.total}
                  </text>
                  {/* The whole person, not one band of them. */}
                  <text
                    x={cx}
                    y={PLOT.h - PLOT.bottom + 18}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={isPickedPerson && !picked.band ? 600 : 400}
                    fill={brand.ink}
                    onClick={() => toggle(d.who, null)}
                    style={{ cursor: "pointer", textDecoration: "underline dotted" }}
                  >
                    {d.first}
                  </text>
                  {d.worst >= 0 && (
                    <text x={cx} y={PLOT.h - PLOT.bottom + 33} textAnchor="middle" fontSize={10} fill={brand.sub}>
                      oldest {d.worst}d
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          <ul
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "4px 18px",
              listStyle: "none",
              padding: 0,
              margin: "10px 0 0",
              fontSize: 12,
              color: brand.sub,
            }}
          >
            {CHASE_BANDS.map((b) => (
              <li key={b.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <i style={{ width: 9, height: 9, borderRadius: 2, background: b.color, display: "inline-block" }} />
                {b.label}
              </li>
            ))}
          </ul>

          {hover && !picked && (
            <div
              style={{
                position: "absolute",
                right: 16,
                top: 12,
                background: brand.ink,
                color: "#fff",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 12,
                pointerEvents: "none",
                maxWidth: 260,
              }}
            >
              <strong>{hover.who}</strong>
              <div>
                {hover.n} of {hover.total} · {bandLabel(hover.band).toLowerCase()}
              </div>
              {hover.worst >= 0 && <div>oldest {hover.worst} days</div>}
            </div>
          )}

          {/* What was clicked, opened in place. */}
          {picked && (
            <div
              style={{
                marginTop: 16,
                border: `1px solid ${brand.line}`,
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  flexWrap: "wrap",
                  padding: "9px 12px",
                  background: "#faf9f6",
                  borderBottom: `1px solid ${brand.line}`,
                }}
              >
                <strong style={{ fontSize: 13 }}>{picked.who}</strong>
                <span style={{ fontSize: 12, color: brand.sub }}>
                  {/* The band when one was clicked, the filter when the whole
                      person was, and nothing when neither narrows it — the
                      count already says how many. */}
                  {picked.band
                    ? `${bandLabel(picked.band).toLowerCase()} · `
                    : filter.key === "all"
                      ? ""
                      : `${filter.label.toLowerCase()} · `}
                  {open.length} {open.length === 1 ? "task" : "tasks"}
                </span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {/* The pills stay the place to actually work through a list;
                      this is the look, that is the desk. */}
                  {onPickPerson && (
                    <button onClick={() => onPickPerson(picked.who)} style={{ ...btn, color: brand.blue }}>
                      Open their board →
                    </button>
                  )}
                  <button onClick={() => setPicked(null)} style={btn}>
                    Close
                  </button>
                </span>
              </div>
              <div style={{ overflowX: "auto", maxHeight: 340, overflowY: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: "right" }}>Quiet</th>
                      <th style={th}>Job</th>
                      <th style={th}>Project</th>
                      <th style={th}>Last touch</th>
                      <th style={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {open.map((r) => {
                      const clock = clockFrom(r);
                      const acct = isAccount(r);
                      return (
                        <tr key={r.taskGid} style={acct ? { background: brand.pinkSoft } : undefined}>
                          <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>
                            {r.days === null ? "—" : `${r.days}d`}
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>
                            {r.crm || "—"}
                            {acct && (
                              <span style={{ marginLeft: 5, fontSize: 10, color: brand.pink }}>ACCT</span>
                            )}
                          </td>
                          <td style={{ ...td, whiteSpace: "normal" }}>{r.projectName || "—"}</td>
                          <td style={{ ...td, color: brand.sub, whiteSpace: "nowrap" }}>
                            {clock.basis === "chased" || clock.basis === "contacted"
                              ? shortDay(clock.day)
                              : "never"}
                          </td>
                          <td style={{ ...td, textAlign: "right" }}>
                            {r.permalink && (
                              <a
                                href={r.permalink}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: brand.blue, textDecoration: "none" }}
                              >
                                Asana ↗
                              </a>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* The same numbers as a table. Required relief for the two palest
              fills, and the thing somebody will actually copy out. */}
          <div style={{ overflowX: "auto", marginTop: 14 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 480 }}>
              <thead>
                <tr>
                  <th style={th}>Owner</th>
                  {CHASE_BANDS.map((b) => (
                    <th key={b.key} style={{ ...th, textAlign: "right" }}>
                      {b.label}
                    </th>
                  ))}
                  <th style={{ ...th, textAlign: "right" }}>Total</th>
                  <th style={{ ...th, textAlign: "right" }}>Oldest</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.who}>
                    <td style={td}>
                      <button
                        onClick={() => toggle(d.who, null)}
                        title={`Open ${d.who}'s tasks here`}
                        style={{
                          border: "none",
                          background: "transparent",
                          padding: 0,
                          font: "inherit",
                          fontWeight: picked && picked.who === d.who ? 600 : 400,
                          color: brand.blue,
                          cursor: "pointer",
                        }}
                      >
                        {d.who}
                      </button>
                    </td>
                    {CHASE_BANDS.map((b) => {
                      const n = d.bands[b.key] || 0;
                      return (
                        <td key={b.key} style={{ ...td, textAlign: "right" }}>
                          {n ? (
                            <button
                              onClick={() => toggle(d.who, b.key)}
                              title={`Open these ${n}`}
                              style={{
                                border: "none",
                                background: "transparent",
                                padding: 0,
                                font: "inherit",
                                fontVariantNumeric: "tabular-nums",
                                color: brand.ink,
                                cursor: "pointer",
                                textDecoration: "underline dotted",
                              }}
                            >
                              {n}
                            </button>
                          ) : (
                            <span style={{ color: "#b3afa6" }}>—</span>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{d.total}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {d.worst >= 0 ? `${d.worst}d` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
