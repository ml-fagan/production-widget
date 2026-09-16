"use client";

import { useState } from "react";

// Raising a pre-order: material wanted for a job that hasn't been handed
// over yet. Lives on Alice's material orders board, since a pre-order is
// something to buy rather than something on the racks — but it's its own file
// because the thing being described is a purchase, not a page.
//
// The CRM is typed from memory or a quote and may not match anything real
// yet. That's the point of it.
export default function PreOrderForm({ brand, onSubmit, onCancel, saving }) {
  const [crm, setCrm] = useState("");
  const [project, setProject] = useState("");
  const [name, setName] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [thickness, setThickness] = useState("");
  const [quantity, setQuantity] = useState("");
  const [supplier, setSupplier] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");

  const input = {
    border: `1px solid ${brand.line}`,
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 13,
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };

  const valid = crm.trim() && name.trim();

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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 80px 70px", gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Material</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Blackbutt NTV" />
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
              name: name.trim(),
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
          {saving ? "Saving…" : "Save pre-order"}
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
