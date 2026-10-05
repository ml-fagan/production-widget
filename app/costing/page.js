"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import CostingWorkbench from "./CostingWorkbench.jsx";
import { createPriceBook } from "../../lib/costing";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { useCapabilities } from "../../lib/useCapabilities.js";

// Costing.
//
// The seven sales templates (DecorZen, Flat Panel, DecorSlat, SlatCreate,
// DecorSlat Max, Cewood, DecorMetl) on one screen, each ported formula for
// formula from its Excel workbook. See lib/costing/README.md.
//
// The engine runs in the browser. What is kept — the prices typed in from
// material orders and the costings saved — lives in the handover app with the
// rest of the record; /api/costing is the way there. Reading is for anyone who
// can see Money; changing anything is Money: Edit, the same right that marks a
// job charged, and the handover app checks it again on every write.

const BRAND = {
  bg: "#f5f3ef",
  ink: "#1c1b19",
  sub: "#6b6862",
  line: "#e5e1d8",
  green: "#408152",
  blue: "#004CFB",
};

// Factory Recovery: the labour rate and overhead the workbooks all share.
// Held outside the component so the engine isn't re-run on every render.
const SETTINGS = { labourRate: 175, overheadPct: 0.125 };

// A price somebody typed in is theirs until they change it, so it shouldn't
// quietly stop counting after six months the way a scraped one would.
const KEEP_ORDER_PRICES_DAYS = 3650;
const REFRESH_MS = 60 * 1000;
const UNAVAILABLE =
  "Saved prices and costings aren't available right now — the calculator still works, but nothing can be saved.";

// One price per item. The server keeps it that way; this only guards against an
// older duplicate from before it did, taking whichever was set last.
const stamp = (p) => String(p.updatedAt || p.orderedAt || "");
function onePerItem(list) {
  const by = new Map();
  for (const p of list) {
    const cur = by.get(p.priceKey);
    if (!cur || stamp(p) >= stamp(cur)) by.set(p.priceKey, p);
  }
  return [...by.values()];
}

export default function CostingPage() {
  const [user, setUser] = useState(null);
  const caps = useCapabilities(user);
  const [prices, setPrices] = useState([]);
  const [costings, setCostings] = useState([]);
  const [saveNote, setSaveNote] = useState("");
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  // Prices are shared: when anyone sets one it is the price for everyone. The
  // page reads them on opening, again whenever it is looked at after being away
  // and once a minute while it is in front of someone, so a change made
  // elsewhere reaches an open screen without a reload.
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/costing", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (json?.ok) {
        setPrices(json.prices ?? []);
        setCostings(json.costings ?? []);
        setSaveNote("");
      } else {
        setSaveNote(UNAVAILABLE);
      }
    } catch {
      setSaveNote(UNAVAILABLE);
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = () => {
      if (!document.hidden) load();
    };
    const timer = setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  // The real jobs, so a costing can be tied to one. A quote often comes before
  // its job exists, so a number that isn't here is flagged, not refused.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/handovers", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!live || !json?.ok) return;
        const seen = new Set();
        const list = [];
        for (const h of [...(json.awaiting ?? []), ...(json.scheduled ?? [])]) {
          const jobId = String(h.jobId ?? "").trim();
          if (!jobId || seen.has(jobId)) continue;
          seen.add(jobId);
          list.push({ jobId, label: [h.project, h.client].filter(Boolean).join(" — ") });
        }
        list.sort((a, b) => b.jobId.localeCompare(a.jobId, "en", { numeric: true }));
        setJobs(list);
      } catch {
        // A job list that can't be reached just leaves the field as plain text.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Writes carry the signed-in person's token so the record has a name on it.
  const write = useCallback(async (body) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) throw new Error("Sign in first so this is recorded against your name.");
    const idToken = await current.getIdToken();
    const res = await fetch("/api/costing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, idToken }),
    });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      throw new Error(
        json?.error === "not_permitted_for_role"
          ? "You need Money: Edit to change prices and costings."
          : json?.error || `Couldn't save (${res.status})`
      );
    }
    return json;
  }, []);

  const savePrice = useCallback(
    async (p) => {
      const json = await write({
        action: "price-save",
        priceKey: p.priceKey,
        rate: p.rate,
        unit: p.unit,
        supplier: p.supplier,
        orderId: p.orderId,
        orderedAt: p.orderedAt,
      });
      setPrices((xs) => [...xs.filter((x) => x.priceKey !== p.priceKey), json.price]);
      // Whatever else changed while this was open comes in too.
      load();
    },
    [write, load]
  );

  const removePrice = useCallback(
    async (id) => {
      await write({ action: "price-remove", id });
      setPrices((xs) => xs.filter((x) => x.id !== id));
      load();
    },
    [write, load]
  );

  const saveCosting = useCallback(
    async (draft) => {
      const json = await write({ action: "costing-save", ...draft });
      setCostings((xs) => (draft.id ? xs.map((x) => (x.id === draft.id ? json.costing : x)) : [...xs, json.costing]));
      return json.costing;
    },
    [write]
  );

  const removeCosting = useCallback(
    async (id) => {
      await write({ action: "costing-remove", id });
      setCostings((xs) => xs.filter((x) => x.id !== id));
    },
    [write]
  );

  // The newest order price for an item beats the price list on every template.
  const shared = useMemo(() => onePerItem(prices), [prices]);
  const priceBook = useMemo(
    () =>
      createPriceBook({
        orders: shared.map((p) => ({
          priceKey: p.priceKey,
          rate: Number(p.rate),
          unit: p.unit,
          orderId: p.orderId || "manual",
          orderedAt: p.orderedAt,
          supplier: p.supplier,
        })),
        maxOrderAgeDays: KEEP_ORDER_PRICES_DAYS,
      }),
    [shared]
  );

  const allowed = caps.tabs.includes("costing");

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
      {/* Three columns — templates, inputs, the sheet — so it wants the width. */}
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>
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
              Costing
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              Cost and sell price for each sales template, built up line by line
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            <SignIn user={user} brand={BRAND} />
          </div>
        </header>

        <Tabs tabs={caps.tabs} current="costing" />

        {allowed ? (
          <div style={{ border: `1px solid ${BRAND.line}`, borderRadius: 10 }}>
            <CostingWorkbench
              settings={SETTINGS}
              user={user?.displayName || user?.email || ""}
              priceBook={priceBook}
              canEdit={caps.invoicing}
              saveNote={saveNote}
              prices={shared}
              costings={costings}
              jobs={jobs}
              onSavePrice={savePrice}
              onRemovePrice={removePrice}
              onSaveCosting={saveCosting}
              onRemoveCosting={removeCosting}
            />
          </div>
        ) : (
          <p style={{ fontSize: 14, color: BRAND.sub }}>
            Costing is part of the Money area. Ask for access on the Access tab if you need it.
          </p>
        )}
      </div>
    </main>
  );
}
