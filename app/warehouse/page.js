"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { useCapabilities } from "../../lib/useCapabilities.js";

// Warehouse — what's on its way in.
//
// The man at the roller door has a delivery docket in his hand with a PO
// number on it and a pallet behind him. He does not have the job number, the
// project, or any idea which of Alice's lines it belongs to. So this board is
// organised the way the paperwork is: by PO, then supplier, with the job
// showing underneath rather than above.
//
// Ticking a delivery here is the same write Alice makes from her own board —
// one record, so the moment it's confirmed the material state on Duncan's
// schedule changes with it. Nobody re-types anything, and either of them can
// do it: whoever gets to it first.

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
const HANDOVER_APP = "https://decorhandover.lyphex.com";
// How far back "just arrived" reaches. Long enough that a morning delivery is
// still on screen at knock-off, short enough that the list stays a list.
const RECENT_DAYS = 7;

const VIEWS = [
  { key: "expected", label: "Expected" },
  { key: "arrived", label: "Just arrived" },
];

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
}

function fmtDay(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

/** Every number in a quantity counts — "2 Rolls", "37 + 3 Spare". */
function countOf(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const found = String(value ?? "").match(/\d+(?:\.\d+)?/g);
  return found ? found.reduce((sum, n) => sum + Number(n), 0) : 0;
}

function size(m) {
  if (!m.length || !m.width) return "";
  return `${m.length} × ${m.width}${m.thickness ? ` × ${m.thickness}` : ""}`;
}

/** Today at midnight, so "due today" doesn't read as late at 9am. */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function WarehousePage() {
  const [data, setData] = useState(null);
  const [preOrders, setPreOrders] = useState([]);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("expected");
  const [user, setUser] = useState(null);
  const caps = useCapabilities(user);
  const canReceive = caps.receiving;
  const [received, setReceived] = useState({});
  const [pending, setPending] = useState({});
  const [stored, setStored] = useState({});

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Pre-orders arrive on the same dock as everything else — material Alice
      // bought before the job was written up — so they belong in the same list
      // under their own PO.
      const [res, preRes] = await Promise.all([
        fetch("/api/handovers", { cache: "no-store" }),
        fetch("/api/pre-orders", { cache: "no-store" }).catch(() => null),
      ]);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load handovers");
      setData(json);
      setError(null);
      const preJson = preRes ? await preRes.json().catch(() => null) : null;
      if (preJson?.ok) setPreOrders(preJson.preOrders || []);
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

  const setLine = useCallback(
    async (jobId, lineId, patch) => {
      if (!canReceive) {
        setActionError("You can see what's coming, but marking it in is for the warehouse or Alice.");
        return;
      }
      // A delivery is signed for by a person. Same rule as Alice's board — the
      // record says who took it in.
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first so this is recorded against your name.");
        return;
      }
      const idToken = await current.getIdToken();

      const key = `${jobId}:${lineId}`;
      setPending((p) => ({ ...p, [key]: true }));
      setActionError(null);
      try {
        const res = await fetch("/api/material-line", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, lineId, idToken, ...patch }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Update failed");
        setStored((s) => ({ ...s, [jobId]: json.materials }));
      } catch (e) {
        setActionError(`Couldn't update ${jobId}. ${String(e.message || e)}`);
      } finally {
        setPending((p) => ({ ...p, [key]: false }));
      }
    },
    [canReceive]
  );

  /**
   * A pre-order landing, from the dock.
   *
   * It doesn't simply close: jobs may have claimed part of it off their
   * picking lists, so those are filled first and the balance becomes stock.
   * The handover app does that in one batch — all that's said here is how many
   * came off the truck.
   */
  const preOrderArrived = useCallback(
    async (row, arrived) => {
      if (!canReceive) {
        setActionError("You can see what's coming, but marking it in is for the warehouse or Alice.");
        return;
      }
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first so this is recorded against your name.");
        return;
      }
      const key = `pre:${row.id}`;
      setPending((p) => ({ ...p, [key]: true }));
      setActionError(null);
      try {
        const idToken = await current.getIdToken();
        const res = await fetch("/api/pre-orders/arrive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: row.id, arrived: String(arrived ?? "").trim(), idToken }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Update failed");
        load();
        if (json.short > 0) {
          setActionError(
            `Booked in — ${json.short} short of what jobs had claimed, so those lines stay outstanding.`
          );
        }
      } catch (e) {
        setActionError(`Couldn't record that arrival. ${String(e.message || e)}`);
      } finally {
        setPending((p) => ({ ...p, [key]: false }));
      }
    },
    [canReceive, load]
  );

  const all = useMemo(
    () => [...(data?.awaiting ?? []), ...(data?.scheduled ?? [])],
    [data]
  );

  // One row per material line, with the job hung off it. Stock lines never
  // appear: nothing is arriving, it's already on the racks.
  const lines = useMemo(() => {
    const jobLines = all.flatMap((h) =>
      (stored[h.jobId] ?? h.materials ?? [])
        .filter((m) => !m.fromStock)
        .map((m) => ({
          ...m,
          jobId: h.jobId,
          project: h.project || h.client || "",
        }))
    );
    // Only pre-orders Alice has actually placed. One still sitting at
    // "to order" isn't on a truck, so it isn't the dock's business yet.
    const preLines = preOrders
      .filter((p) => p.state === "ordered" || p.state === "completed")
      .map((p) => ({
        ...p,
        isPreOrder: true,
        jobId: p.crm,
        hasHandover: all.some((h) => h.jobId === p.crm),
        project: p.project || "",
      }));
    return [...jobLines, ...preLines];
  }, [all, stored, preOrders]);

  const cutoff = useMemo(() => Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000, []);
  const expected = lines.filter((m) => m.state === "ordered" || m.state === "part_received");
  const arrived = lines.filter(
    (m) => m.state === "completed" && (!m.completedAt || new Date(m.completedAt).getTime() >= cutoff)
  );

  const q = query.trim().toLowerCase();
  const matches = (m) =>
    !q ||
    [m.poNumber, m.supplier, m.jobId, m.project, m.name].join(" ").toLowerCase().includes(q);

  const shown = (view === "expected" ? expected : arrived).filter(matches);

  // Grouped by PO, because that's what's printed on the docket. Lines Alice
  // hasn't put a number against yet fall into one group at the bottom — they
  // still arrive, they're just harder to match.
  const groups = useMemo(() => {
    const byKey = new Map();
    for (const m of shown) {
      const po = String(m.poNumber || "").trim();
      const key = po ? `po:${po.toLowerCase()}` : `sup:${(m.supplier || "").toLowerCase()}`;
      const group = byKey.get(key) ?? { key, po, supplier: m.supplier || "", lines: [] };
      if (!group.supplier && m.supplier) group.supplier = m.supplier;
      group.lines.push(m);
      byKey.set(key, group);
    }
    const list = [...byKey.values()];
    // Soonest first, and anything without a PO last whatever its date — the
    // dock works from a number, so numbered groups are the useful ones.
    const soonest = (g) =>
      g.lines.reduce((min, m) => {
        const t = m.expectedDate ? new Date(m.expectedDate).getTime() : Infinity;
        return t < min ? t : min;
      }, Infinity);
    return list.sort((a, b) => {
      if (Boolean(a.po) !== Boolean(b.po)) return a.po ? -1 : 1;
      return soonest(a) - soonest(b);
    });
  }, [shown]);

  const today = startOfToday().getTime();

  const btn = {
    border: `1px solid ${BRAND.line}`,
    background: BRAND.card,
    color: BRAND.ink,
    borderRadius: 8,
    padding: "7px 14px",
    fontSize: 13,
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
              Warehouse
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              Find the PO on the docket, tick off what came in.
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

        <Tabs
          tabs={caps.tabs}
          current="warehouse"
          counts={{
            warehouse: expected.length,
            materials: lines.filter((m) => m.state !== "completed").length,
          }}
        />

        <div
          style={{
            display: "flex",
            gap: 18,
            marginBottom: 16,
            borderBottom: `1px solid ${BRAND.line}`,
          }}
        >
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              style={{
                border: "none",
                borderBottom: `2px solid ${view === v.key ? BRAND.sub : "transparent"}`,
                background: "none",
                color: view === v.key ? BRAND.ink : "#9c988f",
                fontWeight: view === v.key ? 600 : 400,
                fontSize: 13,
                padding: "0 0 7px",
                marginBottom: -1,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {v.label} ({v.key === "expected" ? expected.length : arrived.length})
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
              border: `1px solid ${BRAND.red}`,
              color: BRAND.red,
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            Couldn&apos;t load deliveries. {error}
          </div>
        )}

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type the PO number off the docket — or a supplier, job or material"
          style={{
            width: "100%",
            border: `1px solid ${BRAND.line}`,
            background: BRAND.card,
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 15,
            fontFamily: "inherit",
            marginBottom: 16,
            boxSizing: "border-box",
          }}
        />

        {!loading && groups.length === 0 && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            {view === "expected"
              ? q
                ? "Nothing outstanding matches that. Check the arrived tab — it may already be booked in."
                : "Nothing on order. Everything Alice has placed is in."
              : "Nothing booked in over the last week."}
          </p>
        )}

        {groups.map((g) => (
          <section
            key={g.key}
            style={{
              background: BRAND.card,
              border: `1px solid ${BRAND.line}`,
              borderRadius: 10,
              marginBottom: 12,
              overflow: "hidden",
            }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                flexWrap: "wrap",
                padding: "10px 14px",
                borderBottom: `1px solid ${BRAND.line}`,
                background: "#fbfaf8",
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 600 }}>
                {g.po ? `PO ${g.po}` : "No PO number"}
              </span>
              <span style={{ fontSize: 13, color: BRAND.sub }}>{g.supplier || "Supplier not named"}</span>
              <span style={{ fontSize: 12, color: BRAND.sub, marginLeft: "auto" }}>
                {g.lines.length} {g.lines.length === 1 ? "line" : "lines"}
              </span>
            </header>

            {g.lines.map((m) => {
              const pre = Boolean(m.isPreOrder);
              const key = pre ? `pre:${m.id}` : `${m.jobId}:${m.id}`;
              const busy = pending[key];
              const want = countOf(m.quantity);
              const had = countOf(m.receivedQty);
              const savedQty = String(m.receivedQty ?? "");
              const draft = received[key] ?? savedQty;
              const changed = draft.trim() !== savedQty.trim();
              const clear = () =>
                setReceived((r) => {
                  const next = { ...r };
                  delete next[key];
                  return next;
                });
              const savePart = () => {
                if (!changed) return clear();
                setLine(m.jobId, m.id, { receivedQty: draft.trim() });
                clear();
              };
              const late =
                m.expectedDate && new Date(m.expectedDate).getTime() < today && m.state !== "completed";

              return (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                    padding: "10px 14px",
                    borderBottom: `1px solid ${BRAND.line}`,
                  }}
                >
                  <div style={{ minWidth: 220, flex: "1 1 240px" }}>
                    <div style={{ fontSize: 14 }}>
                      {m.name || "Material"}
                      {size(m) && (
                        <span style={{ color: BRAND.sub, fontSize: 12 }}> · {size(m)}</span>
                      )}
                      {pre && (
                        <span
                          title="Bought ahead of the job. Whatever's been claimed against it goes to those jobs, the rest onto the racks."
                          style={{
                            marginLeft: 6,
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: "0.03em",
                            color: BRAND.amber,
                            border: `1px solid ${BRAND.amber}`,
                            borderRadius: 4,
                            padding: "0 4px",
                          }}
                        >
                          PRE-ORDER
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: BRAND.sub, marginTop: 2 }}>
                      {/* Which job it's for, for anyone who wants it — but
                          second, because the dock works from the docket. A
                          pre-order may name a job nobody has written up yet, so
                          there's nothing to open. */}
                      {pre && !m.hasHandover ? (
                        <span style={{ fontWeight: 600, color: BRAND.ink }} title="No handover under this number yet">
                          {m.jobId}
                        </span>
                      ) : (
                        <a
                          href={`${HANDOVER_APP}/${encodeURIComponent(m.jobId)}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: BRAND.blue, textDecoration: "none", fontWeight: 600 }}
                        >
                          {m.jobId}
                        </a>
                      )}
                      {m.project ? ` · ${m.project}` : ""}
                      {m.expectedDate && (
                        <span style={{ color: late ? BRAND.red : BRAND.sub }}>
                          {` · due ${fmtDay(m.expectedDate)}${late ? " — overdue" : ""}`}
                        </span>
                      )}
                      {m.state === "completed" && m.completedAt && (
                        <span style={{ color: BRAND.green }}>
                          {` · booked in ${fmtDay(m.completedAt)}${m.completedBy ? ` by ${m.completedBy}` : ""}`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ fontSize: 13, minWidth: 110 }}>
                    <strong>{m.quantity || "—"}</strong>
                    <span style={{ color: BRAND.sub }}> expected</span>
                    {had > 0 && m.state !== "completed" && (
                      <div style={{ fontSize: 12, color: BRAND.amber }}>
                        {want > had ? `${had} of ${want} in · ${want - had} to come` : `${had} in`}
                      </div>
                    )}
                  </div>

                  {m.state === "completed" ? (
                    <span style={{ color: BRAND.green, fontSize: 13, fontWeight: 500, marginLeft: "auto" }}>
                      ✓ Booked in
                    </span>
                  ) : pre ? (
                    /* A pre-order arrives once, whole: what jobs have claimed
                       goes to them and the rest onto the racks. There's no
                       part-receipt to keep, so it's a count and a button. */
                    <span
                      style={{ display: "inline-flex", gap: 6, alignItems: "center", marginLeft: "auto" }}
                    >
                      <input
                        type="number"
                        min="0"
                        placeholder={String(m.quantity ?? "")}
                        value={received[key] ?? ""}
                        onChange={(e) => setReceived((r) => ({ ...r, [key]: e.target.value }))}
                        disabled={busy || !canReceive}
                        title="How many came off the truck. Leave it blank if the lot arrived."
                        aria-label={`Arrived of ${m.quantity} for ${m.name || m.jobId}`}
                        style={{
                          width: 64,
                          border: `1px solid ${received[key] ? BRAND.amber : BRAND.line}`,
                          borderRadius: 6,
                          padding: "6px 8px",
                          fontSize: 14,
                          fontFamily: "inherit",
                        }}
                      />
                      <span style={{ fontSize: 12, color: BRAND.sub }}>of {m.quantity || "—"}</span>
                      <button
                        onClick={() => {
                          preOrderArrived(m, received[key]);
                          clear();
                        }}
                        disabled={busy || !canReceive}
                        title="It's here — fills any job waiting on it, the rest goes to stock"
                        style={{
                          ...btn,
                          background: BRAND.green,
                          borderColor: BRAND.green,
                          color: "#fff",
                          opacity: busy || !canReceive ? 0.6 : 1,
                        }}
                      >
                        Arrived
                      </button>
                    </span>
                  ) : (
                    <span
                      style={{
                        display: "inline-flex",
                        gap: 6,
                        alignItems: "center",
                        marginLeft: "auto",
                      }}
                    >
                      {/* Part deliveries are the normal case, not the odd one:
                          300 sheets rarely turn up on one truck. The count is
                          what makes "200 of 300" reach Duncan's board. */}
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={draft}
                        onChange={(e) => setReceived((r) => ({ ...r, [key]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") savePart();
                          if (e.key === "Escape") clear();
                        }}
                        onBlur={savePart}
                        disabled={busy || !canReceive}
                        title="How many came off the truck. Leave it and press All in if the lot arrived."
                        aria-label={`Received of ${m.quantity} for ${m.name || m.jobId}`}
                        style={{
                          width: 64,
                          border: `1px solid ${changed ? BRAND.amber : BRAND.line}`,
                          borderRadius: 6,
                          padding: "6px 8px",
                          fontSize: 14,
                          fontFamily: "inherit",
                        }}
                      />
                      <span style={{ fontSize: 12, color: BRAND.sub }}>of {m.quantity || "—"}</span>
                      {changed && (
                        <button
                          onClick={savePart}
                          disabled={busy}
                          style={{
                            ...btn,
                            background: BRAND.amber,
                            borderColor: BRAND.amber,
                            color: "#fff",
                            opacity: busy ? 0.6 : 1,
                          }}
                        >
                          Save
                        </button>
                      )}
                      <button
                        onClick={() => setLine(m.jobId, m.id, { state: "completed" })}
                        disabled={busy || !canReceive}
                        title="The whole line arrived — closes it and tells the schedule"
                        style={{
                          ...btn,
                          background: BRAND.green,
                          borderColor: BRAND.green,
                          color: "#fff",
                          opacity: busy || !canReceive ? 0.6 : 1,
                        }}
                      >
                        All in
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </section>
        ))}

        <p style={{ fontSize: 12, color: BRAND.sub, marginTop: 18 }}>
          Booking a delivery in here is the same as Alice ticking it off her board — the job&apos;s
          material status updates on the schedule straight away, so Duncan can see it&apos;s landed.
        </p>
      </div>
    </main>
  );
}
