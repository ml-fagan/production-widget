"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { useCapabilities } from "../../lib/useCapabilities.js";

// The material list — one register of what this company buys.
//
// It exists because the alternative was everybody typing. The picking list
// said "Blackbutt NTV", the rack card said "Blackbutt", the register held one
// product as two, and a job drew 28 sheets that as far as the numbers were
// concerned had never been bought. Six materials were in that state before
// this page existed.
//
// Keyed on the finish, because that's how the factory talks about material and
// how the racks are organised — substrate, thickness and size are how you
// narrow it down afterwards, not what it's called.
//
// Mitch keeps it. Everyone else picks from it: the picking list, Alice's stock
// and her pre-orders all offer these words and nothing else, so what's ordered,
// what's on the racks and what a job is waiting for are the same string.

const BRAND = {
  bg: "#f5f3ef",
  card: "#ffffff",
  ink: "#1c1b19",
  sub: "#6b6862",
  line: "#e5e1d8",
  green: "#408152",
  amber: "#a86b12",
  blue: "#004CFB",
  red: "#a3312c",
};

function fmtStamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function MaterialListPage() {
  const [materials, setMaterials] = useState([]);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [user, setUser] = useState(null);
  const caps = useCapabilities(user);
  // Keeping the list is the same right as writing a handover: Mitch's, and the
  // managers'. Deliberately not Alice's — the moment ordering can add to the
  // list, ordering starts adding spellings.
  const canEdit = caps.handover;
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ finish: "", supplier: "", note: "" });
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState({ finish: "", supplier: "", note: "" });
  const [showRetired, setShowRetired] = useState(false);

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/material-list", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load the material list");
      setMaterials(json.materials || []);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const send = useCallback(async (payload) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first — every change to the list is recorded against a name.");
      return false;
    }
    setSaving(true);
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch("/api/material-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idToken }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Save failed");
      setMaterials(json.materials || []);
      return true;
    } catch (e) {
      setActionError(String(e.message || e));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const q = query.trim().toLowerCase();
  const shown = materials
    .filter((m) => (showRetired ? true : m.active))
    .filter((m) => !q || [m.finish, m.supplier, m.note].join(" ").toLowerCase().includes(q));
  const retiredCount = materials.filter((m) => !m.active).length;

  const btn = {
    border: `1px solid ${BRAND.line}`,
    background: BRAND.card,
    color: BRAND.ink,
    borderRadius: 8,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  };
  const th = {
    fontWeight: 600,
    fontSize: 11,
    textAlign: "left",
    padding: "6px 10px",
    borderBottom: `1px solid ${BRAND.line}`,
    whiteSpace: "nowrap",
    color: BRAND.sub,
  };
  const td = {
    padding: "6px 10px",
    borderBottom: `1px solid ${BRAND.line}`,
    fontSize: 13,
  };
  const input = {
    border: `1px solid ${BRAND.line}`,
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 13,
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <main
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        background: BRAND.bg,
        color: BRAND.ink,
        minHeight: "100vh",
        padding: "24px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 20,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              Material list
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              Every finish this company buys, and who supplies it. Everything else picks from here.
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            <SignIn user={user} brand={BRAND} />
            <button onClick={load} style={{ ...btn, padding: "6px 12px", fontSize: 13 }}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        <Tabs tabs={caps.tabs} current="materiallist" />

        {actionError && (
          <div
            style={{
              background: "#fdf4e6",
              border: `1px solid ${BRAND.amber}`,
              color: BRAND.amber,
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {actionError}
          </div>
        )}
        {error && (
          <div
            style={{
              background: "#fbeceb",
              border: `1px solid ${BRAND.red}`,
              color: BRAND.red,
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            Couldn&apos;t load the material list. {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by finish, supplier or note"
            style={{ ...input, flex: 1 }}
          />
          {retiredCount > 0 && (
            <button onClick={() => setShowRetired((v) => !v)} style={btn}>
              {showRetired ? "Hide retired" : `Show retired (${retiredCount})`}
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => setShowAdd((v) => !v)}
              style={{
                ...btn,
                background: BRAND.green,
                borderColor: BRAND.green,
                color: "#fff",
                padding: "8px 16px",
                fontSize: 13,
              }}
            >
              + Add material
            </button>
          )}
        </div>

        {showAdd && canEdit && (
          <div
            style={{
              background: BRAND.card,
              border: `1px solid ${BRAND.line}`,
              borderRadius: 10,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr", gap: 8, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: BRAND.sub }}>Finish</label>
                <input
                  style={input}
                  autoFocus
                  value={draft.finish}
                  onChange={(e) => setDraft((d) => ({ ...d, finish: e.target.value }))}
                  placeholder="As everyone should say it — e.g. Blackbutt NTV"
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: BRAND.sub }}>Supplier</label>
                <input
                  style={input}
                  value={draft.supplier}
                  onChange={(e) => setDraft((d) => ({ ...d, supplier: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: BRAND.sub }}>Note (optional)</label>
                <input
                  style={input}
                  value={draft.note}
                  onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                  placeholder="Lead time, minimum order, who to ring"
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                disabled={saving || !draft.finish.trim()}
                onClick={async () => {
                  const ok = await send({ action: "add", ...draft });
                  if (ok) {
                    setDraft({ finish: "", supplier: "", note: "" });
                    setShowAdd(false);
                  }
                }}
                style={{
                  ...btn,
                  background: BRAND.green,
                  borderColor: BRAND.green,
                  color: "#fff",
                  padding: "6px 16px",
                  fontSize: 13,
                  opacity: saving || !draft.finish.trim() ? 0.6 : 1,
                }}
              >
                {saving ? "Saving…" : "Add to the list"}
              </button>
              <button onClick={() => setShowAdd(false)} style={{ ...btn, padding: "6px 16px", fontSize: 13 }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {!loading && materials.length === 0 && (
          <div
            style={{
              background: BRAND.card,
              border: `1px solid ${BRAND.line}`,
              borderRadius: 10,
              padding: "16px 18px",
              fontSize: 13,
            }}
          >
            <p style={{ margin: "0 0 10px" }}>
              Nothing on the list yet. Start it from the finishes the handover form already offers —
              they come across as they are, and you can edit, add to and retire them from here
              afterwards.
            </p>
            {canEdit && (
              <button
                onClick={() => send({ action: "seed" })}
                disabled={saving}
                style={{
                  ...btn,
                  background: BRAND.green,
                  borderColor: BRAND.green,
                  color: "#fff",
                  padding: "6px 16px",
                  fontSize: 13,
                }}
              >
                {saving ? "Starting…" : "Start the list from the current finishes"}
              </button>
            )}
          </div>
        )}

        {shown.length > 0 && (
          <div
            style={{
              background: BRAND.card,
              border: `1px solid ${BRAND.line}`,
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>Finish</th>
                  <th style={th}>Supplier</th>
                  <th style={th}>Note</th>
                  <th style={th}>Added</th>
                  <th style={th}>Last change</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => {
                  const editing = editId === m.id;
                  return (
                    <tr key={m.id} style={m.active ? undefined : { background: "#faf9f6", color: BRAND.sub }}>
                      <td style={{ ...td, fontWeight: 500 }}>
                        {editing ? (
                          <input
                            style={input}
                            value={edit.finish}
                            onChange={(e) => setEdit((x) => ({ ...x, finish: e.target.value }))}
                          />
                        ) : (
                          <>
                            {m.finish}
                            {!m.active && (
                              <span style={{ marginLeft: 6, fontSize: 10, color: BRAND.sub }}>retired</span>
                            )}
                          </>
                        )}
                      </td>
                      <td style={td}>
                        {editing ? (
                          <input
                            style={input}
                            value={edit.supplier}
                            onChange={(e) => setEdit((x) => ({ ...x, supplier: e.target.value }))}
                          />
                        ) : (
                          m.supplier || <span style={{ color: BRAND.sub }}>—</span>
                        )}
                      </td>
                      <td style={{ ...td, color: BRAND.sub }}>
                        {editing ? (
                          <input
                            style={input}
                            value={edit.note}
                            onChange={(e) => setEdit((x) => ({ ...x, note: e.target.value }))}
                          />
                        ) : (
                          m.note || "—"
                        )}
                      </td>
                      {/* Who put a word into everyone's mouth, and when. */}
                      <td style={{ ...td, color: BRAND.sub, fontSize: 12, whiteSpace: "nowrap" }}>
                        {fmtStamp(m.addedAt)}
                        {m.addedBy ? ` · ${m.addedBy.split("@")[0]}` : ""}
                      </td>
                      <td style={{ ...td, color: BRAND.sub, fontSize: 12, whiteSpace: "nowrap" }}>
                        {m.updatedAt
                          ? `${fmtStamp(m.updatedAt)}${m.updatedBy ? ` · ${m.updatedBy.split("@")[0]}` : ""}`
                          : "—"}
                      </td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                        {canEdit &&
                          (editing ? (
                            <>
                              <button
                                disabled={saving}
                                onClick={async () => {
                                  const ok = await send({ action: "update", id: m.id, ...edit });
                                  if (ok) setEditId(null);
                                }}
                                style={{
                                  ...btn,
                                  background: BRAND.green,
                                  borderColor: BRAND.green,
                                  color: "#fff",
                                  marginRight: 6,
                                }}
                              >
                                Save
                              </button>
                              <button onClick={() => setEditId(null)} style={btn}>
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setEditId(m.id);
                                  setEdit({ finish: m.finish, supplier: m.supplier, note: m.note });
                                }}
                                style={{ ...btn, marginRight: 6 }}
                              >
                                Edit
                              </button>
                              {/* Retired, not deleted: old records keep reading
                                  and nobody re-adds it next month by accident. */}
                              <button
                                onClick={() =>
                                  send({ action: m.active ? "retire" : "restore", id: m.id })
                                }
                                disabled={saving}
                                style={{ ...btn, color: m.active ? BRAND.sub : BRAND.green }}
                                title={
                                  m.active
                                    ? "Stop offering this — it stays on old records"
                                    : "Offer this again"
                                }
                              >
                                {m.active ? "Retire" : "Restore"}
                              </button>
                            </>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ fontSize: 12, color: BRAND.sub, marginTop: 16, maxWidth: 760 }}>
          These are the only finishes the picking list, the stock register and the pre-order form
          offer, so what Mitch orders against, what Alice puts on the racks and what a job is waiting
          for are the same words. Substrate, thickness and sheet size are how you narrow it down
          afterwards — the finish is what it&apos;s called.
          {!canEdit && " Changes to the list are Mitch's; ask him to add one."}
        </p>
      </div>
    </main>
  );
}
