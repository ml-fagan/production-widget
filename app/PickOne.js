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
export default function PickOne({ value, onChange, options, label, style }) {
  const inList = options.includes(value);
  const [custom, setCustom] = useState(Boolean(value) && !inList);

  if (custom) {
    return (
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
