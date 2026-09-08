"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";

// Material stock — offcuts Duncan logs as leftover at packing/dispatch, plus
// whatever Alice adds or uses herself: pre-ordering ahead of a job, or
// drawing down what's on the shelf for a different one.
//
// Append-only ledger: every add or use is its own entry, and the balance for
// a material is just the sum of its entries. Nothing here edits or deletes a
// past entry, so the history stays honest — using stock is a new negative
// entry, not erasing the positive one that brought it in.

const BRAND = {
  bg: "#f5f3ef",
  card: "#ffffff",
  ink: "#1c1b19",
  sub: "#6b6862",
  line: "#e5e1d8",
  green: "#408152",
  amber: "#a86b12",
  red: "#a3312c",
  blue: "#004CFB",
};

const REFRESH_MS = 15 * 60 * 1000;

function signature(e) {
  return [
    String(e.name || "").trim().toLowerCase(),
    String(e.length ?? "").trim(),
    String(e.width ?? "").trim(),
    String(e.thickness ?? "").trim(),
  ].join("|");
}

function balancesFrom(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = signature(e);
    if (!map.has(key)) {
      map.set(key, { name: e.name, length: e.length, width: e.width, thickness: e.thickness, total: 0, entries: [] });
    }
    const bucket = map.get(key);
    bucket.total += Number(e.quantity) || 0;
    bucket.entries.push(e);
  }
  for (const bucket of map.values()) {
    bucket.entries.sort((a, b) => (a.loggedAt < b.loggedAt ? 1 : -1));
  }
  return [...map.values()].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

function fmtStamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function MaterialStockPage() {
  const [entries, setEntries] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [query, setQuery] = useState("");
  const [user, setUser] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [useRow, setUseRow] = useState(null); // signature of the row being drawn down
  const [expanded, setExpanded] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/material-stock", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load material stock");
      setEntries(json.entries || []);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  // For the job picker on "Use" — so assigning stock to a job means picking
  // the real CRM, not typing a name that might not match anything.
  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/handovers", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) return;
      setJobs([...(json.awaiting || []), ...(json.scheduled || [])]);
    } catch {
      // The picker just comes up empty; using stock without a job still works.
    }
  }, []);

  useEffect(() => {
    load();
    loadJobs();
    const id = setInterval(() => {
      load();
      loadJobs();
    }, REFRESH_MS);
    const onFocus = () => {
      load();
      loadJobs();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, loadJobs]);

  const submit = useCallback(
    async (entry) => {
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first so this is recorded against your name.");
        return false;
      }
      setSaving(true);
      setActionError(null);
      try {
        const idToken = await current.getIdToken();
        const res = await fetch("/api/material-stock/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: [{ ...entry, source: "manual" }], idToken }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Save failed");
        setEntries((prev) => [...(json.entries || []), ...prev]);
        return true;
      } catch (e) {
        setActionError(String(e.message || e));
        return false;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const balances = useMemo(() => balancesFrom(entries), [entries]);
  const q = query.trim().toLowerCase();
  const matching = q ? balances.filter((b) => (b.name || "").toLowerCase().includes(q)) : balances;
  const available = matching.filter((b) => b.total > 0);

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
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
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
              Material stock
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              {available.length} material{available.length === 1 ? "" : "s"} on hand — offcuts and
              pre-ordered stock, reusable across jobs
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            <SignIn user={user} brand={BRAND} />
            <button
              onClick={load}
              style={{
                border: `1px solid ${BRAND.line}`,
                background: BRAND.card,
                color: BRAND.ink,
                borderRadius: 8,
                padding: "6px 12px",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        <Tabs current="stock" />

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
            Couldn&apos;t load material stock. {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by material"
            style={{
              flex: 1,
              border: `1px solid ${BRAND.line}`,
              background: BRAND.card,
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 14,
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={() => setShowAdd((v) => !v)}
            style={{
              border: `1px solid ${BRAND.green}`,
              background: BRAND.green,
              color: "#fff",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            + Add stock
          </button>
        </div>

        {showAdd && (
          <AddStockForm
            brand={BRAND}
            saving={saving}
            onCancel={() => setShowAdd(false)}
            onSubmit={async (entry) => {
              const ok = await submit({ ...entry, quantity: Math.abs(entry.quantity) });
              if (ok) setShowAdd(false);
            }}
          />
        )}

        {!loading && available.length === 0 && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            {balances.length === 0
              ? "No material logged yet — leftovers from Duncan's board will show up here, or add some yourself."
              : "Nothing on hand matches that filter."}
          </p>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          {available.map((b) => {
            const key = signature(b);
            const locations = [...new Set(b.entries.map((e) => e.location).filter(Boolean))];
            return (
              <section
                key={key}
                style={{
                  background: BRAND.card,
                  border: `1px solid ${BRAND.line}`,
                  borderRadius: 10,
                  padding: "14px 16px",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{b.name || "—"}</span>
                  {b.length && b.width ? (
                    <span style={{ fontSize: 13, color: BRAND.sub }}>
                      {b.length} × {b.width}
                      {b.thickness ? ` × ${b.thickness}` : ""}
                    </span>
                  ) : null}
                  <span style={{ fontSize: 14, fontWeight: 600, color: BRAND.green, marginLeft: "auto" }}>
                    {b.total} on hand
                  </span>
                  <button
                    onClick={() => setUseRow(useRow === key ? null : key)}
                    style={{
                      border: `1px solid ${BRAND.line}`,
                      background: BRAND.card,
                      color: BRAND.ink,
                      borderRadius: 8,
                      padding: "4px 10px",
                      fontSize: 12,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    − Use
                  </button>
                </div>
                {locations.length > 0 && (
                  <div style={{ fontSize: 12, color: BRAND.sub, marginTop: 4 }}>
                    Where: {locations.join(", ")}
                  </div>
                )}

                {useRow === key && (
                  <UseStockForm
                    brand={BRAND}
                    max={b.total}
                    jobs={jobs}
                    saving={saving}
                    onCancel={() => setUseRow(null)}
                    onSubmit={async (patch) => {
                      const ok = await submit({
                        name: b.name,
                        length: b.length,
                        width: b.width,
                        thickness: b.thickness,
                        quantity: -Math.abs(patch.quantity),
                        jobId: patch.jobId,
                        project: patch.project,
                        note: patch.note,
                      });
                      if (ok) setUseRow(null);
                    }}
                  />
                )}

                <button
                  onClick={() => setExpanded((p) => ({ ...p, [key]: !p[key] }))}
                  style={{
                    marginTop: 8,
                    background: "none",
                    border: "none",
                    color: BRAND.blue,
                    fontSize: 12,
                    cursor: "pointer",
                    padding: 0,
                    fontFamily: "inherit",
                  }}
                >
                  {expanded[key] ? "Hide history" : `History (${b.entries.length})`}
                </button>

                {expanded[key] && (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 8 }}>
                    <tbody>
                      {b.entries.map((e) => (
                        <tr key={e.id} style={{ borderTop: `1px solid ${BRAND.line}` }}>
                          <td style={{ padding: "4px 8px 4px 0", color: e.quantity < 0 ? BRAND.red : BRAND.green, fontWeight: 500 }}>
                            {e.quantity > 0 ? `+${e.quantity}` : e.quantity}
                          </td>
                          <td style={{ padding: "4px 8px", color: BRAND.sub }}>
                            {e.source === "leftover" ? "Leftover" : "Manual"}
                            {e.jobId ? ` · ${e.jobId}${e.project ? ` (${e.project})` : ""}` : ""}
                          </td>
                          <td style={{ padding: "4px 8px", color: BRAND.sub }}>{e.note}</td>
                          <td style={{ padding: "4px 0", color: BRAND.sub, textAlign: "right", whiteSpace: "nowrap" }}>
                            {e.loggedBy} · {fmtStamp(e.loggedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function AddStockForm({ brand, onSubmit, onCancel, saving }) {
  const [name, setName] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [thickness, setThickness] = useState("");
  const [quantity, setQuantity] = useState("");
  const [location, setLocation] = useState("");
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 90px 80px", gap: 8, marginBottom: 8 }}>
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
          <input type="number" style={input} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Where it is (optional)</label>
          <input style={input} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Rack 3, near CNC" />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Note (optional)</label>
          <input style={input} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          disabled={!name.trim() || !Number(quantity) || saving}
          onClick={() =>
            onSubmit({
              name: name.trim(),
              length,
              width,
              thickness,
              quantity: Number(quantity) || 0,
              location: location.trim(),
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
            opacity: !name.trim() || !Number(quantity) || saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Add"}
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

// Search-as-you-type over the live job list, so assigning stock to a job
// means picking the real CRM rather than typing something that might not
// match anything on the schedule board.
function JobPicker({ brand, jobs, value, onChange, placeholder }) {
  const [text, setText] = useState(value ? `${value.jobId} — ${value.project || ""}` : "");
  const [open, setOpen] = useState(false);

  const q = text.trim().toLowerCase();
  const matches = q
    ? jobs
        .filter((j) => `${j.jobId} ${j.project || j.client || ""}`.toLowerCase().includes(q))
        .slice(0, 8)
    : [];

  const input = {
    border: `1px solid ${brand.line}`,
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 13,
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        style={input}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && matches.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "#fff",
            border: `1px solid ${brand.line}`,
            borderRadius: 6,
            marginTop: 2,
            zIndex: 10,
            maxHeight: 180,
            overflowY: "auto",
            boxShadow: "0 4px 10px rgba(0,0,0,0.08)",
          }}
        >
          {matches.map((j) => (
            <div
              key={j.jobId}
              onMouseDown={() => {
                const picked = { jobId: j.jobId, project: j.project || j.client || "" };
                onChange(picked);
                setText(`${picked.jobId} — ${picked.project}`);
                setOpen(false);
              }}
              style={{ padding: "6px 10px", fontSize: 13, cursor: "pointer" }}
            >
              <strong>{j.jobId}</strong> {j.project || j.client || ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UseStockForm({ brand, max, jobs, onSubmit, onCancel, saving }) {
  const [quantity, setQuantity] = useState("");
  const [job, setJob] = useState(null);
  const [note, setNote] = useState("");

  const input = {
    border: `1px solid ${brand.line}`,
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 13,
    fontFamily: "inherit",
  };

  const qty = Number(quantity) || 0;
  const valid = qty > 0 && qty <= max;

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${brand.line}` }}>
      <div>
        <label style={{ fontSize: 11, color: brand.sub, display: "block" }}>How many (of {max})</label>
        <input type="number" style={{ ...input, width: 80 }} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </div>
      <div style={{ width: 220 }}>
        <label style={{ fontSize: 11, color: brand.sub, display: "block" }}>Assign to a job (optional)</label>
        <JobPicker brand={brand} jobs={jobs} value={job} onChange={setJob} placeholder="Search CRM or project" />
      </div>
      <div style={{ flex: 1, minWidth: 140 }}>
        <label style={{ fontSize: 11, color: brand.sub, display: "block" }}>Note (optional)</label>
        <input style={{ ...input, width: "100%", boxSizing: "border-box" }} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <button
        disabled={!valid || saving}
        onClick={() =>
          onSubmit({
            quantity: qty,
            jobId: job?.jobId || null,
            project: job?.project || "",
            note: note.trim(),
          })
        }
        style={{
          border: `1px solid ${brand.red}`,
          background: brand.red,
          color: "#fff",
          borderRadius: 8,
          padding: "6px 14px",
          fontSize: 13,
          cursor: "pointer",
          fontFamily: "inherit",
          opacity: !valid || saving ? 0.6 : 1,
        }}
      >
        {saving ? "Saving…" : "Confirm use"}
      </button>
      <button
        onClick={onCancel}
        style={{
          border: `1px solid ${brand.line}`,
          background: brand.card,
          color: brand.sub,
          borderRadius: 8,
          padding: "6px 14px",
          fontSize: 13,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Cancel
      </button>
    </div>
  );
}
