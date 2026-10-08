"use client";

import { useMemo, useState } from "react";
import { CHASE_BANDS, CHASE_FILTERS, overviewFor } from "../../lib/drafting.js";

/**
 * Who is carrying what, and how late it is.
 *
 * One bar per person, stacked by how long since anybody was in touch. The
 * height answers "how much is on them"; the darkness answers "how much of it
 * has gone quiet". Both at once, because either on its own is misleading —
 * ninety-two rows is only alarming if they are old, and four rows at a
 * hundred days is worse than forty fresh ones.
 *
 * The colour never says who. Names are nominal, so every bar uses the same
 * ramp; a per-person palette would be eight hues encoding nothing, and the
 * one thing worth seeing would be gone.
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
  const [minDays, setMinDays] = useState(0);
  const [hover, setHover] = useState(null);

  const data = useMemo(() => overviewFor(rows, now, minDays), [rows, now, minDays]);
  const shown = data.filter((d) => d.total > 0);
  const max = Math.max(1, ...shown.map((d) => d.total));
  const { top, step } = ticksFor(max);

  const innerW = PLOT.w - PLOT.left - PLOT.right;
  const innerH = PLOT.h - PLOT.top - PLOT.bottom;
  const slot = shown.length ? innerW / shown.length : innerW;
  // Thin marks: a bar is a mark, not a container.
  const barW = Math.min(64, Math.max(18, slot * 0.52));
  const y = (v) => PLOT.top + innerH - (v / top) * innerH;

  const gridlines = [];
  for (let v = 0; v <= top + 0.001; v += step) gridlines.push(v);

  const total = shown.reduce((a, d) => a + d.total, 0);
  const filterLabel =
    CHASE_FILTERS.find((f) => f.min === minDays)?.label ?? "Everything";

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
      {/* Filters in one row above the chart. */}
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
          {total} {total === 1 ? "task" : "tasks"}
          {minDays > 0 ? ` not touched in ${minDays === 14 ? "two" : minDays === 21 ? "three" : "four"} weeks or more` : ""}
        </span>
        {CHASE_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setMinDays(f.min)}
            title={
              f.min === 0
                ? "Every task on the board"
                : `Only what nobody has touched in ${f.min} days or more`
            }
            style={{
              ...btn,
              background: minDays === f.min ? brand.ink : brand.card,
              borderColor: minDays === f.min ? brand.ink : brand.line,
              color: minDays === f.min ? "#fff" : brand.sub,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p style={{ fontSize: 13, color: brand.sub, margin: "20px 0" }}>
          Nothing is {filterLabel.toLowerCase()} overdue. That is the good answer.
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${PLOT.w} ${PLOT.h}`}
            width="100%"
            role="img"
            aria-label={`Tasks per person, ${filterLabel}`}
            style={{ display: "block", overflow: "visible" }}
          >
            {/* Recessive grid: present enough to read a value off, quiet
                enough not to compete with the bars. */}
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
                <text
                  x={PLOT.left - 8}
                  y={y(v) + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill={brand.sub}
                >
                  {v}
                </text>
              </g>
            ))}

            {shown.map((d, i) => {
              const cx = PLOT.left + slot * i + slot / 2;
              const x = cx - barW / 2;
              let cursor = 0;
              // Darkest at the bottom: the part that matters sits on the
              // baseline where it can be compared across bars, rather than
              // floating at a different height in every column.
              const order = [...CHASE_BANDS].reverse();
              return (
                <g key={d.who}>
                  {order.map((band) => {
                    const n = d.bands[band.key] || 0;
                    if (!n) return null;
                    const h = (n / top) * innerH;
                    const yTop = PLOT.top + innerH - cursor - h;
                    cursor += h;
                    const isTop = cursor >= (d.total / top) * innerH - 0.5;
                    const on = hover && hover.who === d.who && hover.band === band.key;
                    return (
                      <rect
                        key={band.key}
                        x={x}
                        // A 2px gap between segments, taken off the top so the
                        // stack still adds up against the axis.
                        y={yTop + (isTop ? 0 : 0)}
                        width={barW}
                        height={Math.max(1, h - 2)}
                        rx={isTop ? 4 : 0}
                        fill={band.color}
                        opacity={hover && !on ? 0.55 : 1}
                        onMouseEnter={() => setHover({ who: d.who, band: band.key, n, total: d.total, worst: d.worst })}
                        onMouseLeave={() => setHover(null)}
                        style={{ cursor: "default" }}
                      />
                    );
                  })}
                  {/* The total, labelled directly — so the chart is readable
                      without hovering and without reading colours. */}
                  <text
                    x={cx}
                    y={y(d.total) - 7}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={600}
                    fill={brand.ink}
                  >
                    {d.total}
                  </text>
                  <text
                    x={cx}
                    y={PLOT.h - PLOT.bottom + 18}
                    textAnchor="middle"
                    fontSize={12}
                    fill={brand.ink}
                  >
                    {d.first}
                  </text>
                  {d.worst >= 0 && (
                    <text
                      x={cx}
                      y={PLOT.h - PLOT.bottom + 33}
                      textAnchor="middle"
                      fontSize={10}
                      fill={brand.sub}
                    >
                      oldest {d.worst}d
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Legend: always present for more than one series, so identity is
              never carried by colour alone. */}
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
                <i
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 2,
                    background: b.color,
                    display: "inline-block",
                  }}
                />
                {b.label}
              </li>
            ))}
          </ul>

          {hover && (
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
                {hover.n} of {hover.total} ·{" "}
                {CHASE_BANDS.find((b) => b.key === hover.band)?.label.toLowerCase()}
              </div>
              {hover.worst >= 0 && <div>oldest {hover.worst} days</div>}
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
                        onClick={() => onPickPerson && onPickPerson(d.who)}
                        title={`Show ${d.who}'s rows`}
                        style={{
                          border: "none",
                          background: "transparent",
                          padding: 0,
                          font: "inherit",
                          color: brand.blue,
                          cursor: "pointer",
                        }}
                      >
                        {d.who}
                      </button>
                    </td>
                    {CHASE_BANDS.map((b) => (
                      <td key={b.key} style={{ ...td, textAlign: "right" }}>
                        {d.bands[b.key] || <span style={{ color: "#b3afa6" }}>—</span>}
                      </td>
                    ))}
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
