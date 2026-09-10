"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { confirmAndDeleteJob, deleteLinkStyle } from "../deleteJob.js";

// Invoicing board.
//
// Every handed-over job with what it's charged on — the figure Mitch entered at
// handover, per m² or per sheet. Veronica marks each one charged and it moves
// to the charged folder, the same way Alice works her material orders.
//
// Read-only on the figure itself: that's Mitch's, and if it's wrong the fix is
// on the handover, not here.

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

const REFRESH_MS = 15 * 60 * 1000;
const HANDOVER_APP = "https://decorhandover.lyphex.com";

const VIEWS = [
  { key: "to_charge", label: "To charge" },
  { key: "charged", label: "Charged" },
];

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
}

function fmtStamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// A line only counts as priced once it has an amount — one entered without a
// basis is still shown (Mitch may not have decided m²-vs-sheet yet), just
// without a unit label.
function lineLabel(line) {
  const priced = line.amount !== "" && line.amount != null;
  const unit = line.basis === "sheet" ? "sheets" : line.basis === "m2" ? "m²" : "";
  return { priced, text: priced ? `${line.amount}${unit ? ` ${unit}` : ""}` : "not priced" };
}

export default function InvoicingPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("to_charge");
  const [user, setUser] = useState(null);
  const [pending, setPending] = useState({});
  const [stored, setStored] = useState({});

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/handovers", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load handovers");
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const invoiceOf = (h) => stored[h.jobId] ?? h.invoice ?? { state: "to_charge" };
  const stateOf = (h) => invoiceOf(h).state || "to_charge";

  const setInvoice = useCallback(async (jobId, patch) => {
    let idToken = null;
    if (patch.state === "charged") {
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first so this is recorded against your name.");
        return;
      }
      idToken = await current.getIdToken();
    } else if (firebaseConfigured() && auth().currentUser) {
      idToken = await auth().currentUser.getIdToken();
    }

    setPending((p) => ({ ...p, [jobId]: true }));
    setActionError(null);
    try {
      const res = await fetch("/api/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, idToken, ...patch }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Update failed");
      setStored((s) => ({ ...s, [jobId]: json.invoice }));
    } catch (e) {
      setActionError(`Couldn't update ${jobId}. ${String(e.message || e)}`);
    } finally {
      setPending((p) => ({ ...p, [jobId]: false }));
    }
  }, []);

  const deleteJob = async (row) => {
    const result = await confirmAndDeleteJob(row);
    if (result.cancelled) return;
    if (result.error) {
      setActionError(result.error);
      return;
    }
    setActionError(null);
    setData((d) =>
      d
        ? {
            ...d,
            awaiting: (d.awaiting || []).filter((h) => h.jobId !== row.jobId),
            scheduled: (d.scheduled || []).filter((h) => h.jobId !== row.jobId),
          }
        : d
    );
  };

  const all = [...(data?.awaiting ?? []), ...(data?.scheduled ?? [])];
  const q = query.trim().toLowerCase();
  const matching = q
    ? all.filter((h) =>
        [h.jobId, h.project, h.client, h.product].join(" ").toLowerCase().includes(q)
      )
    : all;

  const counts = {
    to_charge: matching.filter((h) => stateOf(h) === "to_charge").length,
    charged: matching.filter((h) => stateOf(h) === "charged").length,
  };
  const jobs = matching.filter((h) => stateOf(h) === view);
  // No billable line at all, or every billable line still has no amount.
  const missingFigure = jobs.filter((h) => {
    const lines = h.invoiceLines ?? [];
    return lines.length === 0 || lines.every((l) => !lineLabel(l).priced);
  }).length;

  const btn = {
    border: `1px solid ${BRAND.line}`,
    background: BRAND.card,
    color: BRAND.ink,
    borderRadius: 8,
    padding: "5px 12px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
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
              Invoicing
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
              {missingFigure > 0 &&
                view === "to_charge" &&
                ` · ${missingFigure} with no figure entered yet`}
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            <SignIn user={user} brand={BRAND} />
            <button onClick={load} style={{ ...btn, padding: "6px 12px", fontSize: 13 }}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <div style={{ marginTop: 6 }}>
              {data?.fetchedAt ? `Updated ${fmtTime(data.fetchedAt)}` : ""}
            </div>
          </div>
        </header>

        <Tabs current="invoicing" counts={{ invoicing: counts.to_charge }} />

        <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              style={{
                ...btn,
                background: view === v.key ? BRAND.ink : BRAND.card,
                color: view === v.key ? "#fff" : BRAND.sub,
                fontSize: 13,
              }}
            >
              {v.label} ({counts[v.key]})
            </button>
          ))}
        </div>

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
              border: "1px solid #a3312c",
              color: "#a3312c",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            Couldn&apos;t load handovers. {error}
          </div>
        )}

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by CRM, project or product"
          style={{
            width: "100%",
            border: `1px solid ${BRAND.line}`,
            background: BRAND.card,
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 14,
            fontFamily: "inherit",
            marginBottom: 16,
            boxSizing: "border-box",
          }}
        />

        {!loading && jobs.length === 0 && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            {all.length === 0
              ? "Nothing handed over yet."
              : view === "to_charge"
                ? "Everything's been charged."
                : "Nothing charged yet."}
          </p>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          {jobs.map((h) => {
            const invoice = invoiceOf(h);
            const lines = h.invoiceLines ?? [];
            const anyPriced = lines.some((l) => lineLabel(l).priced);
            const busy = pending[h.jobId];
            return (
              <section
                key={h.jobId}
                style={{
                  background: BRAND.card,
                  border: `1px solid ${BRAND.line}`,
                  borderLeft: `3px solid ${
                    invoice.state === "charged"
                      ? BRAND.green
                      : anyPriced
                        ? BRAND.amber
                        : BRAND.line
                  }`,
                  borderRadius: 10,
                  padding: "14px 16px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <a
                    href={`${HANDOVER_APP}/${encodeURIComponent(h.jobId)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontWeight: 600, fontSize: 14, color: BRAND.blue, textDecoration: "none" }}
                  >
                    {h.jobId}
                  </a>
                  <span style={{ fontSize: 14 }}>{h.project || h.client || "—"}</span>
                  {h.client && h.project && (
                    <span style={{ fontSize: 12, color: BRAND.sub }}>{h.client}</span>
                  )}

                  <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                    {invoice.state === "to_charge" ? (
                      <button
                        onClick={() => setInvoice(h.jobId, { state: "charged" })}
                        disabled={busy}
                        style={{
                          ...btn,
                          background: BRAND.green,
                          borderColor: BRAND.green,
                          color: "#fff",
                          opacity: busy ? 0.6 : 1,
                        }}
                      >
                        Charged
                      </button>
                    ) : (
                      <button
                        onClick={() => setInvoice(h.jobId, { state: "to_charge" })}
                        disabled={busy}
                        style={{ ...btn, color: BRAND.green }}
                        title={
                          invoice.chargedBy
                            ? `Charged by ${invoice.chargedBy}`
                            : "Charged"
                        }
                      >
                        ✓ Charged
                      </button>
                    )}
                    {invoice.state === "charged" && (
                      <button
                        onClick={() => deleteJob(h)}
                        title="Remove this job and its record completely"
                        style={deleteLinkStyle}
                      >
                        Delete
                      </button>
                    )}
                  </span>
                </div>

                <div style={{ marginTop: 10, fontSize: 13 }}>
                  {lines.length === 0 ? (
                    <span style={{ color: BRAND.amber }}>No products or materials entered yet.</span>
                  ) : (
                    <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
                      <tbody>
                        {lines.map((l) => {
                          const label = lineLabel(l);
                          return (
                            <tr key={l.id}>
                              <td style={{ padding: "2px 10px 2px 0", color: BRAND.sub, fontFamily: "'SF Mono', ui-monospace, monospace", fontSize: 12 }}>
                                {l.code || "—"}
                              </td>
                              <td style={{ padding: "2px 10px 2px 0" }}>{l.name || "—"}</td>
                              <td style={{ padding: "2px 10px 2px 0", color: BRAND.sub }}>
                                {l.quantity !== "" && l.quantity != null ? `× ${l.quantity}` : ""}
                              </td>
                              <td style={{ padding: "2px 10px 2px 0" }}>
                                {label.priced ? (
                                  <strong>{label.text}</strong>
                                ) : (
                                  <span style={{ color: BRAND.amber }}>{label.text}</span>
                                )}
                              </td>
                              <td style={{ padding: "2px 0", color: BRAND.red, fontWeight: 500 }}>
                                {l.note || ""}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 20,
                    flexWrap: "wrap",
                    marginTop: 8,
                    fontSize: 13,
                  }}
                >
                  {h.charge?.note && <Fact label="Note">{h.charge.note}</Fact>}
                  <Fact label="Despatch">{h.schedule?.actualDate || h.schedule?.committedDate || "—"}</Fact>
                </div>

                {invoice.state === "charged" && (
                  <p style={{ fontSize: 12, color: BRAND.sub, margin: "10px 0 0" }}>
                    Charged by {invoice.chargedBy || "unknown"}
                    {invoice.chargedAt ? ` · ${fmtStamp(invoice.chargedAt)}` : ""}
                    {invoice.reference ? ` · ref ${invoice.reference}` : ""}
                  </p>
                )}

                <div style={{ marginTop: 10 }}>
                  <input
                    defaultValue={invoice.reference || ""}
                    onBlur={(e) => {
                      if ((invoice.reference || "") !== e.target.value) {
                        setInvoice(h.jobId, { reference: e.target.value });
                      }
                    }}
                    placeholder="Invoice reference (optional)"
                    style={{
                      border: `1px solid ${BRAND.line}`,
                      borderRadius: 6,
                      padding: "4px 8px",
                      fontSize: 12,
                      fontFamily: "inherit",
                      width: 240,
                    }}
                  />
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function Fact({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#6b6862" }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}
