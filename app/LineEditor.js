"use client";

import { useEffect, useState } from "react";
import PickOne from "./PickOne.js";

/**
 * Putting a material line right from the ordering board.
 *
 * Mitch writes the picking list, but its mistakes surface at Alice's end — a
 * substrate nobody stocks, a count that's out, the wrong supplier. Sending her
 * back to the handover to fix a number she is looking at is how a job waits a
 * day, so it's editable here until it's ordered, and not after: from then on
 * the line says what a supplier was asked for.
 *
 * Same fields whichever kind of line it is. A pre-order and a picking-list line
 * describe the same thing — a board, a size, a count, a supplier — and only the
 * endpoint that stores them differs.
 */
export default function LineEditor({ brand, line, saving, onCancel, onSave }) {
  const [finish, setFinish] = useState(line.finish ?? "");
  const [substrate, setSubstrate] = useState(line.substrate ?? "");
  const [supplier, setSupplier] = useState(line.supplier ?? "");
  const [length, setLength] = useState(String(line.length ?? ""));
  const [width, setWidth] = useState(String(line.width ?? ""));
  const [thickness, setThickness] = useState(String(line.thickness ?? ""));
  const [quantity, setQuantity] = useState(String(line.quantity ?? ""));
  const [options, setOptions] = useState({ finishes: [], substrates: [] });

  useEffect(() => {
    let active = true;
    fetch("/api/materials/options", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (active && json.ok) {
          setOptions({ finishes: json.finishes || [], substrates: json.substrates || [] });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const input = {
    border: `1px solid ${brand.line}`,
    borderRadius: 6,
    padding: "5px 8px",
    fontSize: 13,
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };
  const label = { fontSize: 11, color: brand.sub };
  const btn = {
    border: `1px solid ${brand.line}`,
    background: brand.card,
    color: brand.ink,
    borderRadius: 8,
    padding: "5px 14px",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
  };

  return (
    <div style={{ padding: "10px 0 4px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 150px 90px 90px 80px 80px",
          gap: 8,
          alignItems: "end",
        }}
      >
        <div>
          <label style={label}>Finish</label>
          <PickOne
            value={finish}
            onChange={setFinish}
            options={options.finishes}
            label="Finish"
            style={input}
          />
        </div>
        <div>
          <label style={label}>Substrate</label>
          <PickOne
            value={substrate}
            onChange={setSubstrate}
            options={options.substrates}
            label="Substrate"
            style={input}
          />
        </div>
        <div>
          <label style={label}>Supplier</label>
          <input style={input} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </div>
        <div>
          <label style={label}>Length</label>
          <input style={input} value={length} onChange={(e) => setLength(e.target.value)} />
        </div>
        <div>
          <label style={label}>Width</label>
          <input style={input} value={width} onChange={(e) => setWidth(e.target.value)} />
        </div>
        <div>
          <label style={label}>Thick</label>
          <input style={input} value={thickness} onChange={(e) => setThickness(e.target.value)} />
        </div>
        <div>
          <label style={label}>Qty</label>
          <input style={input} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <button
          onClick={() =>
            onSave({
              finish: finish.trim(),
              substrate: substrate.trim(),
              supplier: supplier.trim(),
              length,
              width,
              thickness,
              quantity,
            })
          }
          disabled={saving}
          style={{
            ...btn,
            background: brand.green,
            borderColor: brand.green,
            color: "#fff",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save line"}
        </button>
        <button onClick={onCancel} style={btn}>
          Cancel
        </button>
        <span style={{ fontSize: 12, color: brand.sub }}>
          Only until it&apos;s ordered — after that the line is what the supplier was asked for.
        </span>
      </div>
    </div>
  );
}
