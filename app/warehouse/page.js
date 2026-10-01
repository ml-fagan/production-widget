"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SubTabs from "../SubTabs.js";
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

// Hourly. Material takes days to come in after it's ordered, so nothing on
// this page changes on a scale that a five-minute poll could catch — and the
// page reads every handover, every leftover and every pre-order each time it
// does. What actually keeps it current is the dock opening the tab when a
// truck arrives, which refreshes it on focus, and the Refresh button.
// A tab nobody is looking at doesn't need reading for. Every board refreshes
// when it's focused, so a hidden one loses nothing by sitting still — and a
// browser left open over a weekend stops costing anything.
function pollWhenVisible(run, everyMs) {
  return setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    run();
  }, everyMs);
}

const REFRESH_MS = 60 * 60 * 1000;
const HANDOVER_APP = "https://decorhandover.lyphex.com";
// How far back "just arrived" reaches. Long enough that a morning delivery is
// still on screen at knock-off, short enough that the list stays a list.
const RECENT_DAYS = 7;

const VIEWS = [
  { key: "expected", label: "Expected" },
  // Material a handover says is already on a rack. Nothing is arriving, so it
  // was never the dock's business — except that somebody has to walk over and
  // look, and the people who can are out here. Alice can confirm one too; it's
  // the same record either way, so whoever gets to it first is the one who
  // did it.
  { key: "stock", label: "Stock to check" },
  { key: "arrived", label: "Just arrived" },
  // Stock going the other way. A client has paid for something already on the
  // rack, and until now nobody out the back heard about it at all — the order
  // sat on Veronica's board and the material left the building on the
  // strength of a phone call.
  { key: "send", label: "To pack & send" },
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

/** What was bought: the nest's count plus any spare asked for. */
function orderQty(m) {
  return m.orderQty != null ? countOf(m.orderQty) : countOf(m.quantity) + countOf(m.spare);
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
  // Packing is the dock's. Sending is Alice's — she books the freight and she
  // is the one who knows it went.
  const canDispatch = caps.materials;
  const [shelf, setShelf] = useState([]);
  const [saving, setSaving] = useState(false);
  const [received, setReceived] = useState({});
  const [pending, setPending] = useState({});
  const [stored, setStored] = useState({});

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  const loadShelf = useCallback(async () => {
    try {
      const res = await fetch("/api/shelf-orders", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setShelf(json.orders || []);
    } catch {
      // The delivery board is the point of this page; an off-the-shelf list
      // that can't be reached shouldn't take it down.
    }
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
    loadShelf();
    const id = pollWhenVisible(() => {
      load();
      loadShelf();
    }, REFRESH_MS);
    const onFocus = () => {
      load();
      loadShelf();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, loadShelf]);

  /**
   * Packed, or sent.
   *
   * Two marks on one order by two different people, so the button that's
   * offered follows the right rather than the page: the dock packs, Alice
   * sends, and the server checks the same split.
   */
  const markShelf = useCallback(
    async (order, mark) => {
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first so this is recorded against your name.");
        return;
      }
      setSaving(true);
      setActionError(null);
      try {
        const idToken = await current.getIdToken();
        const res = await fetch("/api/shelf-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "contact",
            id: order.id,
            kind: "note",
            mark,
            note: mark === "packed" ? "Packed" : "Dispatched",
            idToken,
          }),
        });
        const json = await res.json();
        if (!json.ok) {
          throw new Error(
            json.needs === "materials"
              ? "Sending it is Alice's — the dock packs, she books the freight."
              : json.error || "That didn't save"
          );
        }
        await loadShelf();
      } catch (e) {
        setActionError(String(e.message || e));
      } finally {
        setSaving(false);
      }
    },
    [loadShelf]
  );

  // Let go and still in the building: the dock's to pack, then Alice's to
  // send. Released is the gate Veronica is asked for after she chases one;
  // paid still counts, so orders taken the old way carry on arriving here.
  const toSend = shelf.filter((o) => (o.releasedAt || o.paidAt) && !o.dispatchedAt);

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
        // Said plainly, because "arrived" no longer means "finished": a part
        // delivery leaves the order open for the rest.
        const bits = [];
        if (json.stillToCome > 0) bits.push(`${json.stillToCome} still to come`);
        if (json.short > 0) bits.push(`${json.short} short of what jobs had claimed`);
        if (bits.length) setActionError(`Booked in — ${bits.join(" · ")}.`);
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

  // One row per material line, with the job hung off it. Stock lines are in
  // here now: nothing is arriving, but somebody still has to go and check the
  // rack, and the delivery views below keep them out so "Expected" stays about
  // things on a truck.
  const lines = useMemo(() => {
    const jobLines = all.flatMap((h) =>
      (stored[h.jobId] ?? h.materials ?? [])
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

  /**
   * What went out, lately.
   *
   * An order used to vanish off this board the moment Alice booked the
   * freight, so the dock had no way to answer "did that go?" — the one
   * question anybody rings them about. The same week's window the delivery
   * side uses, for the same reason.
   */
  const sent = shelf
    .filter((o) => o.dispatchedAt && new Date(o.dispatchedAt).getTime() >= cutoff)
    .sort((a, b) => String(b.dispatchedAt).localeCompare(String(a.dispatchedAt)));
  const expected = lines.filter(
    (m) => !m.fromStock && (m.state === "ordered" || m.state === "part_received")
  );
  const arrived = lines.filter(
    (m) =>
      !m.fromStock &&
      m.state === "completed" &&
      (!m.completedAt || new Date(m.completedAt).getTime() >= cutoff)
  );
  // Claimed off a rack and nobody has walked over to look yet. The whole
  // list, not a recent window: one still owed is still owed, however long it
  // has been sitting there.
  //
  // A line leaves the moment somebody reports what they found, whatever they
  // found — an empty rack is a finished job for the dock, and what happens
  // next is Alice's.
  const stockToCheck = lines.filter(
    (m) => m.fromStock && m.state !== "completed" && !m.rackCheckedAt
  );
  // Checked lately, kept on screen so whoever just did it can see that it
  // took — the same reason "Just arrived" exists. Short and bare racks stay
  // here too, because those are the ones somebody may want to look at twice.
  const stockDone = lines.filter((m) => {
    if (!m.fromStock) return false;
    const when = m.rackCheckedAt || m.completedAt;
    if (!m.rackCheckedAt && m.state !== "completed") return false;
    return !when || new Date(when).getTime() >= cutoff;
  });

  const q = query.trim().toLowerCase();
  const matches = (m) =>
    !q ||
    [
      m.poNumber,
      m.ocNumber,
      m.supplier,
      m.jobId,
      m.project,
      m.name,
      // A line split across two suppliers arrives on two dockets with two
      // numbers. Searching the second one found nothing, which is the moment
      // the dock needs it most.
      ...(m.extraOrders ?? []).flatMap((e) => [e.poNumber, e.ocNumber, e.supplier]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);

  // Two delivery views share one table; the stock check and the pack-and-send
  // list each have their own.
  const isDelivery = view === "expected" || view === "arrived";
  const shown = (view === "expected" ? expected : arrived).filter(matches);
  const stockShown = stockToCheck.filter(matches);
  const stockDoneShown = stockDone.filter(matches);

  // Grouped by PO, because that's what's printed on the docket. Lines Alice
  // hasn't put a number against yet fall into one group at the bottom — they
  // still arrive, they're just harder to match.
  const groups = useMemo(() => {
    const byKey = new Map();
    for (const m of shown) {
      const po = String(m.poNumber || "").trim();
      const key = po ? `po:${po.toLowerCase()}` : `sup:${(m.supplier || "").toLowerCase()}`;
      const group = byKey.get(key) ?? {
        key,
        po,
        supplier: m.supplier || "",
        ocNumber: m.ocNumber || "",
        lines: [],
      };
      if (!group.supplier && m.supplier) group.supplier = m.supplier;
      if (!group.ocNumber && m.ocNumber) group.ocNumber = m.ocNumber;
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
      {/* Wide enough for the table this page exists for. It was capped at
          1000px like a page of prose, which meant a horizontal scrollbar
          on a screen with 900px of empty margin either side. */}
      <div style={{ maxWidth: 1500, margin: "0 auto" }}>
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
            // What's on the dock's plate: deliveries in, racks to check, and
            // orders out.
            warehouse: expected.length + stockToCheck.length + toSend.length,
            materials: lines.filter((m) => m.state !== "completed").length,
          }}
        />

        <SubTabs
          items={VIEWS.map((v) => ({
            ...v,
            count:
              v.key === "expected"
                ? expected.length
                : v.key === "stock"
                  ? stockToCheck.length
                  : v.key === "arrived"
                    ? arrived.length
                    : toSend.length,
          }))}
          current={view}
          onChange={setView}
        />

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
          placeholder="Type the number off the docket — ours or theirs, or a supplier, job or material"
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

        {/* Stock going out rather than coming in. Two ticks by two people:
            the dock packs it off the rack, Alice books the freight and says
            it's gone. */}
        {view === "send" && (
          <>
            {toSend.length === 0 && !loading && (
              <p style={{ fontSize: 13, color: BRAND.sub }}>
                Nothing waiting to go out. Orders land here once Veronica sends one over.
              </p>
            )}
            {toSend.map((order) => {
              const packed = Boolean(order.packedAt);
              return (
                <section
                  key={order.id}
                  style={{
                    background: BRAND.card,
                    border: `1px solid ${packed ? BRAND.green : BRAND.line}`,
                    borderRadius: 10,
                    padding: "12px 14px",
                    marginBottom: 10,
                    display: "flex",
                    gap: 14,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{order.product}</div>
                    <div style={{ fontSize: 13, color: BRAND.sub }}>
                      {order.qty ? `${order.qty} · ` : ""}
                      {order.customer}
                    </div>
                    {/* Where to go and get it, and anything else she was told.
                        An off-the-shelf order has no picking list behind it,
                        so whatever Veronica wrote down is all there is. */}
                    {order.location && (
                      <div style={{ fontSize: 13, marginTop: 3 }}>
                        <span style={{ color: BRAND.sub }}>at </span>
                        <strong style={{ fontWeight: 600 }}>{order.location}</strong>
                      </div>
                    )}
                    {order.note && (
                      <div style={{ fontSize: 12, color: BRAND.sub, marginTop: 3 }}>
                        {order.note}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: BRAND.sub, minWidth: 120 }}>
                    {order.siteDate ? (
                      <>
                        On site{" "}
                        <strong style={{ color: BRAND.ink, fontWeight: 600 }}>
                          {new Date(`${order.siteDate}T12:00:00`).toLocaleDateString("en-AU", {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                        </strong>
                      </>
                    ) : (
                      "No site date"
                    )}
                    {packed && (
                      <div style={{ color: BRAND.green }}>
                        Packed by {String(order.packedBy || "").split("@")[0]}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                    {!packed ? (
                      <button
                        onClick={() => markShelf(order, "packed")}
                        disabled={saving || !canReceive}
                        title="Picked off the rack and packed"
                        style={{
                          ...btn,
                          background: BRAND.green,
                          borderColor: BRAND.green,
                          color: "#fff",
                          opacity: saving || !canReceive ? 0.6 : 1,
                        }}
                      >
                        Packed
                      </button>
                    ) : (
                      <button
                        onClick={() => markShelf(order, "dispatched")}
                        disabled={saving || !canDispatch}
                        title={
                          canDispatch
                            ? "Gone — freight booked and away"
                            : "The dock packs it; Alice books the freight"
                        }
                        style={{
                          ...btn,
                          background: canDispatch ? BRAND.green : BRAND.card,
                          borderColor: canDispatch ? BRAND.green : BRAND.line,
                          color: canDispatch ? "#fff" : BRAND.sub,
                          opacity: saving ? 0.6 : 1,
                        }}
                      >
                        Dispatched
                      </button>
                    )}
                  </div>
                </section>
              );
            })}

            {/* The register of what went out. Without it an order vanished
                off this board the moment the freight was booked, and the dock
                had no way to answer the one question anybody rings them
                about. */}
            {sent.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <p style={{ fontSize: 12, color: BRAND.sub, margin: "0 0 8px" }}>
                  Sent in the last week
                </p>
                {sent.map((order) => (
                  <div
                    key={`sent:${order.id}`}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "baseline",
                      flexWrap: "wrap",
                      fontSize: 12,
                      color: BRAND.sub,
                      padding: "5px 0",
                      borderBottom: `1px solid ${BRAND.line}`,
                    }}
                  >
                    <strong style={{ color: BRAND.ink, fontSize: 13 }}>{order.product}</strong>
                    <span>
                      {order.qty ? `${order.qty} · ` : ""}
                      {order.customer}
                    </span>
                    <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
                      {new Date(order.dispatchedAt).toLocaleDateString("en-AU", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                      {order.dispatchedBy ? ` · ${order.dispatchedBy.split("@")[0]}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/*
            Material a handover says is already on a rack.

            Nothing is arriving, so this was never the dock's business — except
            that somebody has to walk over and look, and the people who can are
            out here. It's the same record Alice sees on her Outstanding tab:
            whoever gets to it first is the one who did it, and it leaves both
            boards at once.

            Grouped by job rather than by supplier, because there isn't one.
        */}
        {view === "stock" && (
          <>
            {!loading && stockShown.length === 0 && (
              <p style={{ fontSize: 13, color: BRAND.sub }}>
                {q
                  ? "Nothing to check matches that."
                  : "Nothing to check — every rack claim has been confirmed."}
              </p>
            )}

            {[...new Set(stockShown.map((m) => m.jobId))].map((jobId) => {
              const rows = stockShown.filter((m) => m.jobId === jobId);
              return (
                <section
                  key={jobId}
                  style={{
                    background: BRAND.card,
                    border: `1px solid ${BRAND.line}`,
                    borderRadius: 10,
                    padding: "12px 14px",
                    marginBottom: 10,
                  }}
                >
                  <header
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "baseline",
                      flexWrap: "wrap",
                      marginBottom: 8,
                    }}
                  >
                    <a
                      href={`${HANDOVER_APP}/${encodeURIComponent(jobId)}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: BRAND.blue, textDecoration: "none", fontWeight: 600 }}
                    >
                      {jobId}
                    </a>
                    <span style={{ fontSize: 13, color: BRAND.sub }}>
                      {rows[0].project || "—"}
                    </span>
                    <span style={{ fontSize: 12, color: BRAND.sub, marginLeft: "auto" }}>
                      {rows.length} {rows.length === 1 ? "line" : "lines"}
                    </span>
                  </header>

                  {rows.map((m) => {
                    const key = `${m.jobId}:${m.id}`;
                    const busy = pending[key];
                    return (
                      <div
                        key={key}
                        style={{
                          display: "flex",
                          gap: 12,
                          alignItems: "center",
                          flexWrap: "wrap",
                          borderTop: `1px solid ${BRAND.line}`,
                          padding: "8px 0 0",
                          marginTop: 8,
                        }}
                      >
                        <div style={{ minWidth: 220, flex: 1 }}>
                          <div style={{ fontSize: 14 }}>{m.name || "—"}</div>
                          <div style={{ fontSize: 12, color: BRAND.sub }}>
                            {[m.length, m.width, m.thickness].filter(Boolean).join(" × ") || "—"}
                          </div>
                        </div>
                        {(() => {
                          /**
                           * Three answers, because a rack gives three.
                           *
                           * It used to give one — "It's there" — which meant a
                           * rack holding twelve of the twenty a job wanted got
                           * ticked off as twenty, and a bare one either got
                           * ticked off anyway or sat on the list for a
                           * fortnight while everybody assumed somebody else
                           * had looked.
                           */
                          const want = orderQty(m) || countOf(m.quantity) || 0;
                          const typed = received[key];
                          const found = typed === undefined ? String(want || "") : typed;
                          const n = countOf(found);
                          const short = n > 0 && want > 0 && n < want;
                          const clearBox = () =>
                            setReceived((r) => {
                              const next = { ...r };
                              delete next[key];
                              return next;
                            });
                          return (
                            <>
                              <span
                                style={{ display: "inline-flex", gap: 4, alignItems: "center" }}
                              >
                                <input
                                  type="number"
                                  min="0"
                                  value={found}
                                  onChange={(e) =>
                                    setReceived((r) => ({ ...r, [key]: e.target.value }))
                                  }
                                  disabled={busy || !canReceive}
                                  aria-label={`How many of ${want} are on the rack`}
                                  title="How many are actually on the rack"
                                  style={{
                                    width: 60,
                                    border: `1px solid ${short ? BRAND.amber : BRAND.line}`,
                                    borderRadius: 6,
                                    padding: "4px 6px",
                                    fontSize: 13,
                                    fontFamily: "inherit",
                                  }}
                                />
                                <span style={{ fontSize: 12, color: BRAND.sub }}>of {want || "—"}</span>
                              </span>

                              <button
                                onClick={() => {
                                  // What's on the rack is what the job gets.
                                  // Sent as the found count rather than as
                                  // "done", so a short rack closes nothing it
                                  // shouldn't.
                                  setLine(m.jobId, m.id, {
                                    rackFound: n,
                                    receivedQty: String(n),
                                    ...(short ? {} : { state: "completed" }),
                                  });
                                  clearBox();
                                }}
                                disabled={busy || !canReceive || n <= 0}
                                title={
                                  short
                                    ? `Only ${n} of ${want} on the rack — the rest goes back to Alice to buy`
                                    : "It's on the rack and it's this job's"
                                }
                                style={{
                                  ...btn,
                                  background: canReceive
                                    ? short
                                      ? BRAND.amber
                                      : BRAND.green
                                    : BRAND.card,
                                  borderColor: canReceive
                                    ? short
                                      ? BRAND.amber
                                      : BRAND.green
                                    : BRAND.line,
                                  color: canReceive ? "#fff" : BRAND.sub,
                                  opacity: busy || n <= 0 ? 0.6 : 1,
                                }}
                              >
                                {busy ? "Saving…" : short ? `Only ${n} there` : "It's all there"}
                              </button>

                              <button
                                onClick={() => {
                                  // Nothing on the rack. The line goes back to
                                  // needing an order, and says so was checked
                                  // — otherwise it reads as never looked at.
                                  setLine(m.jobId, m.id, {
                                    rackFound: 0,
                                    receivedQty: "",
                                    state: "to_order",
                                  });
                                  clearBox();
                                }}
                                disabled={busy || !canReceive}
                                title="Nothing on the rack — Alice will have to buy it"
                                style={{
                                  ...btn,
                                  color: canReceive ? BRAND.red : BRAND.sub,
                                  borderColor: canReceive ? BRAND.red : BRAND.line,
                                  opacity: busy ? 0.6 : 1,
                                }}
                              >
                                Not there
                              </button>
                            </>
                          );
                        })()}
                      </div>
                    );
                  })}
                </section>
              );
            })}

            {stockDoneShown.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <p style={{ fontSize: 12, color: BRAND.sub, margin: "0 0 8px" }}>
                  Confirmed in the last week
                </p>
                {stockDoneShown.map((m) => {
                  const want = orderQty(m) || countOf(m.quantity) || 0;
                  const found = m.rackFound === null || m.rackFound === undefined ? want : m.rackFound;
                  const bare = found === 0;
                  const short = found > 0 && want > 0 && found < want;
                  const who = m.rackCheckedBy || m.completedBy || "";
                  return (
                    <div
                      key={`done:${m.jobId}:${m.id}`}
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        flexWrap: "wrap",
                        fontSize: 12,
                        color: BRAND.sub,
                        padding: "5px 0",
                        borderBottom: `1px solid ${BRAND.line}`,
                      }}
                    >
                      <strong style={{ color: BRAND.ink }}>{m.jobId}</strong>
                      <span>{m.name || "—"}</span>
                      {/* What was found, not what was asked for. The whole
                          point of the three buttons is that those differ. */}
                      <span
                        style={{
                          color: bare ? BRAND.red : short ? BRAND.amber : BRAND.green,
                          fontWeight: 600,
                        }}
                      >
                        {bare ? "nothing on the rack" : short ? `${found} of ${want}` : `all ${want}`}
                      </span>
                      {who && <span>· {who.split("@")[0]}</span>}
                      {(bare || short) && (
                        <span style={{ color: BRAND.sub }}>
                          · {bare ? want : want - found} back to Alice to buy
                        </span>
                      )}
                      <button
                        onClick={() => setLine(m.jobId, m.id, { rackFound: null })}
                        disabled={!canReceive}
                        title="Put it back on the list to be looked at again"
                        style={{ ...btn, marginLeft: "auto", color: BRAND.sub }}
                      >
                        Check again
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <p style={{ fontSize: 12, color: BRAND.sub, marginTop: 18, maxWidth: 760 }}>
              Confirming one here is the same as Alice confirming it on her board — it leaves her
              Outstanding list and lands on All in, and the sheets stay on the register until
              somebody draws them. A short rack or a bare one stays on her list for the difference,
              so she can buy it.
              <br />
              If the rack holds less than the register says it should, that gap is worth closing
              too — count the material on the <a href="/material-stock" style={{ color: BRAND.blue }}>Stock</a> tab and
              the register squares up against what you found.
            </p>
          </>
        )}

        {isDelivery && !loading && groups.length === 0 && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            {view === "expected"
              ? q
                ? "Nothing outstanding matches that. Check the arrived tab — it may already be booked in."
                : "Nothing on order. Everything Alice has placed is in."
              : "Nothing booked in over the last week."}
          </p>
        )}

        {isDelivery &&
          groups.map((g) => (
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
              {/* Some suppliers put their own number on the docket and not
                  ours, so it's worth having both in front of the dock. */}
              {g.ocNumber && (
                <span style={{ fontSize: 12, color: BRAND.sub }}>their ref {g.ocNumber}</span>
              )}
              <span style={{ fontSize: 12, color: BRAND.sub, marginLeft: "auto" }}>
                {g.lines.length} {g.lines.length === 1 ? "line" : "lines"}
              </span>
            </header>

            {g.lines.map((m) => {
              const pre = Boolean(m.isPreOrder);
              const key = pre ? `pre:${m.id}` : `${m.jobId}:${m.id}`;
              const busy = pending[key];
              const want = orderQty(m);
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
                    {/* Bought from more than one place, so it arrives on more
                        than one docket. The card is grouped under the first
                        PO; without this the second docket's number appears
                        nowhere on the board. */}
                    {(m.extraOrders ?? []).length > 0 && (
                      <div style={{ fontSize: 12, color: BRAND.amber, marginTop: 2 }}>
                        also on{" "}
                        {(m.extraOrders ?? [])
                          .map(
                            (e) =>
                              `PO ${e.poNumber || "—"}${e.supplier ? ` (${e.supplier})` : ""}${
                                e.quantity ? ` · ${e.quantity}` : ""
                              }`
                          )
                          .join(" · ")}
                      </div>
                    )}
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
                    <strong>{orderQty(m) || m.quantity || "—"}</strong>
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
                        // What's still owed: a pre-order that came in two
                        // drops shouldn't offer the whole order again.
                        placeholder={String(
                          orderQty(m) - countOf(m.receivedQty) > 0
                            ? orderQty(m) - countOf(m.receivedQty)
                            : m.quantity ?? ""
                        )}
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
                      <span style={{ fontSize: 12, color: BRAND.sub }}>
                        of {orderQty(m) || m.quantity || "—"}
                      </span>
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
                      <span style={{ fontSize: 12, color: BRAND.sub }}>
                        of {orderQty(m) || m.quantity || "—"}
                      </span>
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

        {/* About taking deliveries in, so it belongs to the two views that
            are about taking deliveries in. */}
        {isDelivery && (
          <p style={{ fontSize: 12, color: BRAND.sub, marginTop: 18 }}>
            Booking a delivery in here is the same as Alice ticking it off her board — the
            job&apos;s material status updates on the schedule straight away, so Duncan can see
            it&apos;s landed.
          </p>
        )}
      </div>
    </main>
  );
}
