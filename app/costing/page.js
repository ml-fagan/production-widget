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

export default function CostingPage() {
  const [user, setUser] = useState(null);
  const caps = useCapabilities(user);
  const [prices, setPrices] = useState([]);
  const [costings, setCostings] = useState([]);
  const [saveNote, setSaveNote] = useState("");

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/costing", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!live) return;
        if (json?.ok) {
          setPrices(json.prices ?? []);
          setCostings(json.costings ?? []);
        } else {
          setSaveNote("Saved prices and costings aren't available right now — the calculator still works, but nothing can be saved.");
        }
      } catch {
        if (live) setSaveNote("Saved prices and costings aren't available right now — the calculator still works, but nothing can be saved.");
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
        id: p.id || undefined,
        priceKey: p.priceKey,
        rate: p.rate,
        unit: p.unit,
        supplier: p.supplier,
        orderId: p.orderId,
        orderedAt: p.orderedAt,
      });
      setPrices((xs) => (p.id ? xs.map((x) => (x.id === p.id ? json.price : x)) : [...xs, json.price]));
    },
    [write]
  );

  const removePrice = useCallback(
    async (id) => {
      await write({ action: "price-remove", id });
      setPrices((xs) => xs.filter((x) => x.id !== id));
    },
    [write]
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
  const priceBook = useMemo(
    () =>
      createPriceBook({
        orders: prices.map((p) => ({
          priceKey: p.priceKey,
          rate: Number(p.rate),
          unit: p.unit,
          orderId: p.orderId || "manual",
          orderedAt: p.orderedAt,
          supplier: p.supplier,
        })),
        maxOrderAgeDays: KEEP_ORDER_PRICES_DAYS,
      }),
    [prices]
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
          <div style={{ border: `1px solid ${BRAND.line}`, borderRadius: 10, overflow: "hidden" }}>
            <CostingWorkbench
              settings={SETTINGS}
              user={user?.displayName || user?.email || ""}
              priceBook={priceBook}
              canEdit={caps.invoicing}
              saveNote={saveNote}
              prices={prices}
              costings={costings}
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
