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
export default function LineEditor({ brand, line, locked = false, saving, onCancel, onSave }) {
  const [finish, setFinish] = useState(line.finish ?? "");
  const [substrate, setSubstrate] = useState(line.substrate ?? "");
  const [supplier, setSupplier] = useState(line.supplier ?? "");
  const [length, setLength] = useState(String(line.length ?? ""));
  const [width, setWidth] = useState(String(line.width ?? ""));
  const [thickness, setThickness] = useState(String(line.thickness ?? ""));
  const [quantity, setQuantity] = useState(String(line.quantity ?? ""));
  /**
   * The rest of the order, when one line is bought from two places.
   *
   * Forty sheets from Polytec because they have them, the other twenty-six
   * from Aus Laminators because Polytec didn't. One line on the picking list,
   * two purchase orders — and the line only had room for one, so the second
   * lived in Alice's head and the docket it arrived on matched nothing.
   */
  const [extras, setExtras] = useState(() =>
    (line.extraOrders ?? []).map((e, i) => ({
      id: e.id || `extra-${i}`,
      supplier: e.supplier ?? "",
      poNumber: e.poNumber ?? "",
      ocNumber: e.ocNumber ?? "",
      quantity: String(e.quantity ?? ""),
    }))
  );
  const setExtra = (id, field, value) =>
    setExtras((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
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
  // Greyed rather than hidden: she can still read what was ordered, which is
  // the thing she's checking against the second supplier's quote.
  const lockedInput = locked
    ? { ...input, background: "#f3f1ea", color: brand.sub }
    : input;
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
          {/* Read-only once ordered, as plain text rather than a disabled
              picker: a greyed dropdown still invites a click. */}
          {locked ? (
            <div style={{ ...lockedInput, padding: "6px 8px" }}>{finish || "—"}</div>
          ) : (
            <PickOne
              value={finish}
              onChange={setFinish}
              options={options.finishes}
              label="Finish"
              listOnly
              style={input}
            />
          )}
        </div>
        <div>
          <label style={label}>Substrate</label>
          {locked ? (
            <div style={{ ...lockedInput, padding: "6px 8px" }}>{substrate || "—"}</div>
          ) : (
            <PickOne
              value={substrate}
              onChange={setSubstrate}
              options={options.substrates}
              label="Substrate"
              listOnly
              style={input}
            />
          )}
        </div>
        <div>
          <label style={label}>Supplier</label>
          <input
            style={lockedInput}
            disabled={locked}
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          />
        </div>
        <div>
          <label style={label}>Length</label>
          <input
            style={lockedInput}
            disabled={locked}
            value={length}
            onChange={(e) => setLength(e.target.value)}
          />
        </div>
        <div>
          <label style={label}>Width</label>
          <input
            style={lockedInput}
            disabled={locked}
            value={width}
            onChange={(e) => setWidth(e.target.value)}
          />
        </div>
        <div>
          <label style={label}>Thick</label>
          <input
            style={lockedInput}
            disabled={locked}
            value={thickness}
            onChange={(e) => setThickness(e.target.value)}
          />
        </div>
        <div>
          <label style={label}>Qty</label>
          <input
            style={lockedInput}
            disabled={locked}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
      </div>
      {/* Added beside the line's own supplier and PO rather than replacing
          them: the first order is the one most lines never go past. */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 11, color: brand.sub, marginBottom: 4 }}>
          Also ordered from
        </div>
        {extras.map((row) => (
          <div
            key={row.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 130px 130px 80px 70px",
              gap: 8,
              alignItems: "end",
              marginBottom: 6,
            }}
          >
            <div>
              <label style={label}>Supplier</label>
              <input
                style={input}
                value={row.supplier}
                onChange={(e) => setExtra(row.id, "supplier", e.target.value)}
              />
            </div>
            <div>
              <label style={label}>PO</label>
              <input
                style={input}
                value={row.poNumber}
                onChange={(e) => setExtra(row.id, "poNumber", e.target.value)}
              />
            </div>
            <div>
              <label style={label} title="The supplier's own order confirmation or sales number">
                OC
              </label>
              <input
                style={input}
                value={row.ocNumber}
                onChange={(e) => setExtra(row.id, "ocNumber", e.target.value)}
              />
            </div>
            <div>
              <label style={label}>Qty</label>
              <input
                style={input}
                value={row.quantity}
                onChange={(e) => setExtra(row.id, "quantity", e.target.value)}
              />
            </div>
            <button
              onClick={() => setExtras((rows) => rows.filter((r) => r.id !== row.id))}
              style={{ ...btn, color: brand.sub, padding: "5px 10px" }}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            setExtras((rows) => [
              ...rows,
              {
                id: `extra-${Date.now()}-${rows.length}`,
                // The line's own supplier is almost never the second one, so
                // it starts blank rather than pre-filled with the wrong name.
                supplier: "",
                poNumber: "",
                ocNumber: "",
                quantity: "",
              },
            ])
          }
          style={{ ...btn, color: brand.blue ?? brand.ink, padding: "4px 12px", fontSize: 12 }}
        >
          + Add a PO
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <button
          onClick={() =>
            onSave({
              // A locked line sends only the extra POs. Sending the material
              // fields as well would read as an edit to them, and the server
              // refuses those once a supplier has been asked — so the second
              // PO would be refused along with them.
              ...(locked
                ? {}
                : {
                    finish: finish.trim(),
                    substrate: substrate.trim(),
                    supplier: supplier.trim(),
                    length,
                    width,
                    thickness,
                    quantity,
                  }),
              // Blank rows are somebody who opened the box and changed their
              // mind; the server drops them too, but not sending them keeps
              // the two ends agreeing.
              extraOrders: extras.filter(
                (r) => r.supplier || r.poNumber || r.ocNumber || r.quantity
              ),
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
          The material details are editable only until it&apos;s ordered — after that the line is
          what the supplier was asked for. A second PO can be added at any time, because that&apos;s
          usually when it happens.
        </span>
      </div>
    </div>
  );
}
