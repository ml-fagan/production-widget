"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { useCapabilities } from "../../lib/useCapabilities.js";
import { PAGE_WIDTH, HEADER_HEIGHT, HEADER_GAP } from "../../lib/layout.js";
import { refreshLoop } from "../../lib/refresh.js";

// Review — handovers waiting to be released to the boards that act on them.
//
// Mitch wrote every handover for a year, so "sent to production" could mean
// "Alice may order this and Veronica may charge it" without anybody saying so.
// More people write them now, and those two halves are the expensive ones: a
// wrong picking list is money out the door at a supplier, a wrong charge is
// money out of a client relationship, and neither shows up for days.
//
// The job itself is NOT held. It goes to production the moment it is sent —
// Duncan schedules it, the floor runs it — and only the buying and the billing
// wait. The thing with a deadline keeps moving; the two things with a cost get
// a second pair of eyes.
//
// What the page shows is what the two boards would show, because a review of a
// summary is not a review. The picking list is the picking list, line for line
// and in Alice's own columns; the charge is the charge.
//
// Two releases rather than one, released independently: they are checked by
// reading different things, and somebody happy with the material but wanting
// another look at the rate should be able to say exactly that.

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

const REFRESH_MS = 5 * 60 * 1000;

function fmtStamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function sizeOf(m) {
  const bits = [m.length, m.width].filter((v) => v !== "" && v != null);
  if (!bits.length) return "";
  return `${bits.join(" × ")}${m.thickness ? ` × ${m.thickness}` : ""}`;
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0
    ? n.toLocaleString("en-AU", { style: "currency", currency: "AUD" })
    : "";
}

export default function ReviewPage() {
  const [handovers, setHandovers] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [saving, setSaving] = useState("");
  const [notes, setNotes] = useState({});
  const caps = useCapabilities(user);

  useEffect(() => {
    if (!firebaseConfigured()) return undefined;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/handovers", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Could not load the handovers");
      setHandovers([...(json.awaiting || []), ...(json.scheduled || [])]);
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
  useEffect(() => refreshLoop(load, REFRESH_MS), [load]);

  const held = useMemo(
    () =>
      handovers
        .filter((h) => h.review && (!h.review.material || !h.review.invoice))
        .sort((a, b) => String(a.review?.at || "").localeCompare(String(b.review?.at || ""))),
    [handovers]
  );

  const release = useCallback(
    async (jobId, part) => {
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first — a release carries your name.");
        return;
      }
      setSaving(`${jobId}:${part}`);
      setActionError(null);
      try {
        const idToken = await current.getIdToken();
        const res = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, part, note: (notes[jobId] || "").trim(), idToken }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "That didn't release");
        setNotes((n) => ({ ...n, [jobId]: "" }));
        await load();
      } catch (e) {
        setActionError(String(e.message || e));
      } finally {
        setSaving("");
      }
    },
    [load, notes]
  );

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
  const goBtn = { ...btn, background: BRAND.ink, color: "#fff", borderColor: BRAND.ink };

  return (
    <main
      style={{
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        background: BRAND.bg,
        minHeight: "100vh",
        padding: "28px 24px 60px",
        color: BRAND.ink,
      }}
    >
      <div style={{ maxWidth: PAGE_WIDTH, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: HEADER_GAP,
            minHeight: HEADER_HEIGHT,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              Review
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0", maxWidth: 820 }}>
              {held.length === 0
                ? "Nothing waiting. A handover sent by somebody who can't release their own lands here."
                : `${held.length} ${held.length === 1 ? "handover" : "handovers"} waiting. The jobs are already in production — only the ordering and the charge are held.`}
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            <SignIn user={user} brand={BRAND} />
            <button onClick={load} style={{ ...btn, padding: "6px 12px", fontSize: 13 }}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        <Tabs tabs={caps.tabs} current="review" counts={{ review: held.length }} />

        <div style={{ marginTop: 16 }}>
          {actionError && <Banner colour={BRAND.amber} bg="#fdf4e6" text={actionError} />}
          {error && <Banner colour={BRAND.red} bg="#fbeceb" text={error} />}

          {!caps.handoverReview && !loading && (
            <Banner
              colour={BRAND.sub}
              bg="#f3f1ea"
              text="You can read this queue but not release anything — that needs the Review tick on the Access tab, or Admin."
            />
          )}

          <div style={{ display: "grid", gap: 14 }}>
            {held.map((h) => (
              <ReviewCard
                key={h.jobId}
                h={h}
                can={caps.handoverReview}
                saving={saving}
                note={notes[h.jobId] || ""}
                onNote={(v) => setNotes((n) => ({ ...n, [h.jobId]: v }))}
                onRelease={release}
                btn={btn}
                goBtn={goBtn}
              />
            ))}
          </div>

          {!held.length && !loading && !error && (
            <p style={{ fontSize: 13, color: BRAND.sub, textAlign: "center", padding: 32 }}>
              Nothing to review.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

function Banner({ colour, bg, text }) {
  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${colour}`,
        color: colour,
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 13,
        marginBottom: 14,
      }}
    >
      {text}
    </div>
  );
}

function ReviewCard({ h, can, saving, note, onNote, onRelease, btn, goBtn }) {
  const materialHeld = !h.review?.material;
  const invoiceHeld = !h.review?.invoice;
  const busy = saving.startsWith(`${h.jobId}:`);

  const th = {
    textAlign: "left",
    fontSize: 10.5,
    fontWeight: 500,
    color: BRAND.sub,
    padding: "4px 8px",
    borderBottom: `1px solid ${BRAND.line}`,
    whiteSpace: "nowrap",
  };
  const td = { fontSize: 12, padding: "5px 8px", borderBottom: `1px solid ${BRAND.line}` };

  return (
    <section
      style={{
        background: BRAND.card,
        border: `1px solid ${BRAND.line}`,
        borderLeft: `3px solid ${BRAND.amber}`,
        borderRadius: 10,
        padding: "14px 18px 16px",
        opacity: busy ? 0.5 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{h.jobId}</span>
            <span style={{ fontSize: 14 }}>{h.client || "—"}</span>
          </div>
          <div style={{ fontSize: 12, color: BRAND.sub, marginTop: 2 }}>
            {h.project || h.product || ""}
          </div>
          <div style={{ fontSize: 11.5, color: BRAND.sub, marginTop: 4 }}>
            Sent by {h.review?.by || "somebody"} · {fmtStamp(h.review?.at)}
          </div>
        </div>
        <a
          href={`https://decorhandover.lyphex.com/${encodeURIComponent(h.jobId)}`}
          target="_blank"
          rel="noreferrer"
          style={{ ...btn, textDecoration: "none", alignSelf: "flex-start" }}
          title="Open the handover to change it. Anything wrong is fixed there, not rejected here."
        >
          Open the handover ↗
        </a>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
          gap: 16,
          marginTop: 14,
        }}
      >
        {/* ── What Alice would see ─────────────────────────────────────── */}
        <Half
          title="Material"
          released={h.review?.material}
          held={materialHeld}
          can={can}
          busy={busy}
          onRelease={() => onRelease(h.jobId, "material")}
          goBtn={goBtn}
        >
          {h.materialNote && (
            <p style={{ fontSize: 12, color: BRAND.amber, margin: "0 0 8px" }}>{h.materialNote}</p>
          )}
          {h.materials?.length ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Material</th>
                  <th style={th}>Size</th>
                  <th style={th}>Qty</th>
                  <th style={th}>Supplier</th>
                </tr>
              </thead>
              <tbody>
                {h.materials.map((m) => (
                  <tr key={m.id}>
                    <td style={td}>
                      {m.name || `${m.finish} on ${m.substrate}`}
                      {m.note && (
                        <div style={{ fontSize: 11, color: BRAND.amber }}>{m.note}</div>
                      )}
                    </td>
                    <td style={td}>{sizeOf(m) || "—"}</td>
                    <td style={td}>
                      {m.orderQty || m.quantity || "—"}
                      {m.spare ? (
                        <span style={{ color: BRAND.sub }}> ({m.quantity} + {m.spare})</span>
                      ) : null}
                    </td>
                    <td style={td}>{m.supplier || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ fontSize: 12, color: BRAND.sub, margin: 0 }}>
              No material lines — nothing for Alice to order.
            </p>
          )}
        </Half>

        {/* ── What Veronica would see ──────────────────────────────────── */}
        <Half
          title="Invoicing"
          released={h.review?.invoice}
          held={invoiceHeld}
          can={can}
          busy={busy}
          onRelease={() => onRelease(h.jobId, "invoice")}
          goBtn={goBtn}
        >
          {h.charge?.note && (
            <p style={{ fontSize: 12, color: BRAND.sub, margin: "0 0 8px" }}>{h.charge.note}</p>
          )}
          {h.invoiceLines?.length ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Line</th>
                  <th style={th}>Qty</th>
                  <th style={th}>Basis</th>
                  <th style={th}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {h.invoiceLines.map((l) => (
                  <tr key={l.id}>
                    <td style={td}>
                      {[l.code, l.name].filter(Boolean).join(" · ") || "—"}
                      {l.kind === "additional" && (
                        <span style={{ fontSize: 10.5, color: BRAND.amber }}> additional</span>
                      )}
                      {l.note && <div style={{ fontSize: 11, color: BRAND.sub }}>{l.note}</div>}
                    </td>
                    <td style={td}>{l.quantity || "—"}</td>
                    <td style={td}>{l.basis || "—"}</td>
                    <td style={td}>{money(l.amount) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ fontSize: 12, color: BRAND.sub, margin: 0 }}>
              No charge lines — nothing for Veronica to bill.
            </p>
          )}
        </Half>
      </div>

      {can && (materialHeld || invoiceHeld) && (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            marginTop: 14,
            flexWrap: "wrap",
          }}
        >
          <input
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder="Anything you want on the record (optional)"
            style={{
              flex: "1 1 260px",
              border: `1px solid ${BRAND.line}`,
              borderRadius: 8,
              padding: "7px 11px",
              fontSize: 12.5,
              fontFamily: "inherit",
              background: BRAND.card,
              color: BRAND.ink,
            }}
          />
          <button
            onClick={() => onRelease(h.jobId, "both")}
            disabled={busy}
            style={{ ...goBtn, padding: "7px 16px" }}
          >
            {busy ? "Releasing…" : materialHeld && invoiceHeld ? "Release both" : "Release the rest"}
          </button>
        </div>
      )}
    </section>
  );
}

function Half({ title, released, held, can, busy, onRelease, goBtn, children }) {
  return (
    <div
      style={{
        border: `1px solid ${BRAND.line}`,
        borderRadius: 8,
        padding: "10px 12px 12px",
        background: held ? "#fffdf8" : BRAND.card,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{title}</span>
        {held ? (
          can ? (
            <button onClick={onRelease} disabled={busy} style={goBtn}>
              Release
            </button>
          ) : (
            <span style={{ fontSize: 11, color: BRAND.amber }}>held</span>
          )
        ) : (
          <span style={{ fontSize: 11, color: BRAND.green }}>
            released by {released?.by || "somebody"}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
