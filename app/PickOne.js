"use client";

import { useState } from "react";

/**
 * One value from a list, or anything at all.
 *
 * The finish and substrate lists exist so the same board is called the same
 * thing everywhere — that's what lets stock match a picking list. But the
 * lists are never quite complete, so "Other…" drops to a free text box, with
 * a way back to the list when it turns out the word was there after all.
 *
 * Shared, because every place that names a material has to offer the same
 * words: the stock register, and now the pre-order form.
 */
/** Words worth matching on: "NTV Blackbutt / BAMO" → ["ntv","blackbutt","bamo"]. */
function words(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

/**
 * List entries that look like what's being typed.
 *
 * Deliberately loose — one shared word is enough. Someone typing "Blackbutt"
 * should be shown "NTV Blackbutt / BAMO" even though nothing else matches,
 * because that's exactly the case that splits one product into two names. A
 * couple of extra suggestions cost a glance; a missed one costs a register.
 */
function nearMatches(value, options) {
  const typed = words(value);
  if (typed.length === 0) return [];
  return options
    .filter((o) => {
      const listed = words(o);
      return typed.some((t) => listed.some((l) => l === t || l.includes(t) || t.includes(l)));
    })
    .slice(0, 4);
}

export default function PickOne({ value, onChange, options, label, style }) {
  // Picking "Other…" is a decision and sticks; being off the list is a fact
  // about the value, so it's worked out each render rather than remembered.
  // The distinction matters because the list is fetched: on the first render
  // it's empty, and a remembered "not in the list" left every filled-in value
  // sitting in a free-text box once the list arrived a moment later.
  const [chose, setChose] = useState(false);
  const custom = chose || (Boolean(value) && options.length > 0 && !options.includes(value));
  const setCustom = setChose;

  if (custom) {
    const near = nearMatches(value, options);
    return (
      <div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            style={style}
            value={value}
            placeholder={label}
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            type="button"
            title={`Back to the ${label.toLowerCase()} list`}
            onClick={() => {
              setCustom(false);
              onChange("");
            }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#6b6862" }}
          >
            ↩
          </button>
        </div>
        {/* The list is how stock finds a picking list. "Blackbutt" typed here
            against "NTV Blackbutt / BAMO" on the list is one product the
            register holds as two, and nobody notices until a job draws
            material that isn't there. So anything on the list that looks like
            what's being typed is offered, one click to take it. */}
        {near.length > 0 && (
          <div style={{ fontSize: 11, color: "#a86b12", marginTop: 3, lineHeight: 1.5 }}>
            On the list already:{" "}
            {near.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => {
                  setCustom(false);
                  onChange(o);
                }}
                title="Use this instead, so stock and the picking list say the same thing"
                style={{
                  border: "1px solid #a86b12",
                  background: "none",
                  color: "#a86b12",
                  borderRadius: 4,
                  cursor: "pointer",
                  font: "inherit",
                  padding: "0 5px",
                  marginRight: 4,
                }}
              >
                {o}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <select
      style={style}
      value={value}
      onChange={(e) => {
        if (e.target.value === "__other__") {
          setCustom(true);
          onChange("");
          return;
        }
        onChange(e.target.value);
      }}
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      <option value="__other__">Other…</option>
    </select>
  );
}
