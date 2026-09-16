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
// The same form does the correcting. A pre-order is raised early, from a quote
// or a phone call, so half the time the finish isn't settled or the count
// moves — pass `initial` and it opens filled in, ready to be put right.
export default function PreOrderForm({ brand, onSubmit, onCancel, saving, initial = null }) {
  const [crm, setCrm] = useState(initial?.crm ?? "");
  const [project, setProject] = useState(initial?.project ?? "");
  // Named the way a handover names a material — the finish, then the board
  // it's pressed on. Two fields rather than one line of free text, because
  // Alice orders the face and the substrate from different people, and because
  // a pre-order typed its own way never matches the stock it turns into.
  const [finish, setFinish] = useState(initial?.finish ?? "");
  const [substrate, setSubstrate] = useState(initial?.substrate ?? "");
  const [length, setLength] = useState(String(initial?.length ?? ""));
  const [width, setWidth] = useState(String(initial?.width ?? ""));
  const [thickness, setThickness] = useState(String(initial?.thickness ?? ""));
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? ""));
  const [supplier, setSupplier] = useState(initial?.supplier ?? "");
  const [expectedDate, setExpectedDate] = useState(initial?.expectedDate ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
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

  const valid = crm.trim() && finish.trim();

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
      <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr", gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>CRM</label>
          <input style={input} value={crm} onChange={(e) => setCrm(e.target.value)} placeholder="e.g. 20488-1" />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Project (optional)</label>
          <input style={input} value={project} onChange={(e) => setProject(e.target.value)} placeholder="Until there's a handover to name it" />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Supplier</label>
          <input style={input} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px 80px 80px 70px", gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Finish</label>
          <PickOne value={finish} onChange={setFinish} options={options.finishes} label="Finish" style={input} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Substrate</label>
          <PickOne
            value={substrate}
            onChange={setSubstrate}
            options={options.substrates}
            label="Substrate"
            style={input}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Length</label>
          <input style={input} value={length} onChange={(e) => setLength(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Width</label>
          <input style={input} value={width} onChange={(e) => setWidth(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Thick</label>
          <input style={input} value={thickness} onChange={(e) => setThickness(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Qty</label>
          <input style={input} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Expected (optional)</label>
          <input type="date" style={input} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Note (optional)</label>
          <input style={input} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          disabled={!valid || saving}
          onClick={() =>
            onSubmit({
              crm: crm.trim(),
              project: project.trim(),
              finish: finish.trim(),
              substrate: substrate.trim(),
              length,
              width,
              thickness,
              quantity,
              supplier: supplier.trim(),
              expectedDate,
              note: note.trim(),
            })
          }
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
          {saving ? "Saving…" : initial ? "Save changes" : "Save pre-order"}
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
      </div>
    </div>
  );
}
