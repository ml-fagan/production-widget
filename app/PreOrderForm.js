"use client";

import { useEffect, useState } from "react";
import PickOne from "./PickOne.js";

// Raising a pre-order: material wanted for a job that hasn't been handed
// over yet. Lives on Alice's material orders board, since a pre-order is
// something to buy rather than something on the racks — but it's its own file
// because the thing being described is a purchase, not a page.
//
// The CRM is typed from memory or a quote and may not match anything real
// yet. That's the point of it.
//
// A job rarely needs one material. The job number, the project, when it's
// wanted and why are said once at the top; underneath is a line per material,
// and each line is saved as its own pre-order — because that's what they are
// downstream. They're ordered separately, they arrive separately, and a job
// claims against one of them at a time.
//
// The same form does the correcting. A pre-order is raised early, from a quote
// or a phone call, so half the time the finish isn't settled or the count
// moves — pass `initial` and it opens filled in on a single line, ready to be
// put right. Adding more lines isn't offered there: an edit changes the record
// in front of you, it doesn't quietly raise new ones.
const blankRow = () => ({
  key: Math.random().toString(36).slice(2),
  finish: "",
  substrate: "",
  supplier: "",
  length: "",
  width: "",
  thickness: "",
  quantity: "",
});

export default function PreOrderForm({ brand, onSubmit, onCancel, saving, initial = null }) {
  const [crm, setCrm] = useState(initial?.crm ?? "");
  const [project, setProject] = useState(initial?.project ?? "");
  const [expectedDate, setExpectedDate] = useState(initial?.expectedDate ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  // Named the way a handover names a material — the finish, then the board
  // it's pressed on. Two fields rather than one line of free text, because
  // Alice orders the face and the substrate from different people, and because
  // a pre-order typed its own way never matches the stock it turns into.
  //
  // Supplier sits on the line rather than the header for the same reason: the
  // veneer and the board it goes on often come from two different places.
  const [rows, setRows] = useState(() =>
    initial
      ? [
          {
            key: "one",
            finish: initial.finish ?? "",
            substrate: initial.substrate ?? "",
            supplier: initial.supplier ?? "",
            length: String(initial.length ?? ""),
            width: String(initial.width ?? ""),
            thickness: String(initial.thickness ?? ""),
            quantity: String(initial.quantity ?? ""),
          },
        ]
      : [blankRow()]
  );
  // The same lists the handover offers, served by it rather than copied — see
  // /api/materials/options.
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
      // Both pickers fall back to Other, so a failed fetch costs the list, not
      // the ability to raise a pre-order.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const input = {
    border: `1px solid ${brand.line}`,
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 13,
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };
  const label = { fontSize: 11, color: brand.sub };

  const setRow = (key, field, value) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  // A line with no finish is a line nobody filled in — the last empty one left
  // behind after adding it by accident. It's dropped rather than refused.
  const filled = rows.filter((r) => r.finish.trim());
  const valid = crm.trim() && filled.length > 0;

  const submit = () =>
    onSubmit(
      filled.map((r) => ({
        crm: crm.trim(),
        project: project.trim(),
        finish: r.finish.trim(),
        substrate: r.substrate.trim(),
        length: r.length,
        width: r.width,
        thickness: r.thickness,
        quantity: r.quantity,
        supplier: r.supplier.trim(),
        expectedDate,
        note: note.trim(),
      }))
    );

  return (
    <div
      style={{
        background: brand.card,
        border: `1px solid ${brand.line}`,
        borderRadius: 10,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 8, marginBottom: 12 }}>
        <div>
          <label style={label}>CRM</label>
          <input style={input} value={crm} onChange={(e) => setCrm(e.target.value)} placeholder="e.g. 20488-1" />
        </div>
        <div>
          <label style={label}>Project (optional)</label>
          <input
            style={input}
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="Until there's a handover to name it"
          />
        </div>
      </div>

      {rows.map((r, i) => (
        <div
          key={r.key}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 140px 80px 80px 70px 70px 24px",
            gap: 8,
            marginBottom: 8,
            alignItems: "end",
          }}
        >
          <div>
            {/* Labelled once, then the rows just stack — a second set of
                headings on every line reads as a second form. */}
            {i === 0 && <label style={label}>Finish</label>}
            <PickOne
              value={r.finish}
              onChange={(v) => setRow(r.key, "finish", v)}
              options={options.finishes}
              label="Finish"
              listOnly
              style={input}
            />
          </div>
          <div>
            {i === 0 && <label style={label}>Substrate</label>}
            <PickOne
              value={r.substrate}
              onChange={(v) => setRow(r.key, "substrate", v)}
              options={options.substrates}
              label="Substrate"
              listOnly
              style={input}
            />
          </div>
          <div>
            {i === 0 && <label style={label}>Supplier</label>}
            <input
              style={input}
              value={r.supplier}
              onChange={(e) => setRow(r.key, "supplier", e.target.value)}
            />
          </div>
          <div>
            {i === 0 && <label style={label}>Length</label>}
            <input style={input} value={r.length} onChange={(e) => setRow(r.key, "length", e.target.value)} />
          </div>
          <div>
            {i === 0 && <label style={label}>Width</label>}
            <input style={input} value={r.width} onChange={(e) => setRow(r.key, "width", e.target.value)} />
          </div>
          <div>
            {i === 0 && <label style={label}>Thick</label>}
            <input
              style={input}
              value={r.thickness}
              onChange={(e) => setRow(r.key, "thickness", e.target.value)}
            />
          </div>
          <div>
            {i === 0 && <label style={label}>Qty</label>}
            <input
              style={input}
              value={r.quantity}
              onChange={(e) => setRow(r.key, "quantity", e.target.value)}
            />
          </div>
          <div>
            {rows.length > 1 && (
              <button
                onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}
                title="Remove this material"
                style={{
                  background: "none",
                  border: "none",
                  color: brand.sub,
                  cursor: "pointer",
                  fontSize: 16,
                  lineHeight: 1,
                  padding: "6px 0",
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>
      ))}

      {!initial && (
        <button
          onClick={() => setRows((list) => [...list, blankRow()])}
          style={{
            background: "none",
            border: "none",
            color: brand.blue,
            cursor: "pointer",
            fontSize: 13,
            fontFamily: "inherit",
            padding: 0,
            marginBottom: 12,
          }}
        >
          + Add material
        </button>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8, margin: "4px 0 12px" }}>
        <div>
          <label style={label}>Expected (optional)</label>
          <input
            type="date"
            style={input}
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
          />
        </div>
        <div>
          <label style={label}>Note (optional)</label>
          <input style={input} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          disabled={!valid || saving}
          onClick={submit}
          style={{
            border: `1px solid ${brand.green}`,
            background: brand.green,
            color: "#fff",
            borderRadius: 8,
            padding: "6px 16px",
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "inherit",
            opacity: !valid || saving ? 0.6 : 1,
          }}
        >
          {saving
            ? "Saving…"
            : initial
              ? "Save changes"
              : filled.length > 1
                ? `Save ${filled.length} pre-orders`
                : "Save pre-order"}
        </button>
        <button
          onClick={onCancel}
          style={{
            border: `1px solid ${brand.line}`,
            background: brand.card,
            color: brand.sub,
            borderRadius: 8,
            padding: "6px 16px",
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
        {/* The date and the note apply to every line, since they're about the
            job rather than the board. */}
        {!initial && filled.length > 1 && (
          <span style={{ fontSize: 12, color: brand.sub }}>
            One pre-order each, all under {crm.trim() || "this CRM"}.
          </span>
        )}
      </div>
    </div>
  );
}
