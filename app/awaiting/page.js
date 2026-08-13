"use client";

import { useCallback, useEffect, useState } from "react";
import Tabs from "../Tabs.js";

// Duncan's queue: handovers Mitch has logged that have no row in the schedule
// yet. Nothing to tick off — a job leaves this list the moment its CRM appears
// in the spreadsheet, and shows up on the schedule as normal.

const BRAND = {
  bg: "#f5f3ef",
  card: "#ffffff",
  ink: "#1c1b19",
  sub: "#6b6862",
  line: "#e5e1d8",
  blue: "#004CFB",
  red: "#a3312c",
};

const REFRESH_MS = 15 * 60 * 1000;
const HANDOVER_APP = "https://decorhandover.lyphex.com";

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

export default function AwaitingPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const awaiting = data?.awaiting ?? [];
  const unordered = [...(data?.awaiting ?? []), ...(data?.scheduled ?? [])].filter(
    (h) => !h.materialOrder?.actioned
  );

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
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 16,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              Awaiting scheduling
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              Handed over, not yet on the production schedule
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
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
            <div style={{ marginTop: 6 }}>
              {data?.fetchedAt ? `Updated ${fmtTime(data.fetchedAt)}` : ""}
            </div>
          </div>
        </header>

        <Tabs
          current="awaiting"
          counts={{ awaiting: awaiting.length, materials: unordered.length }}
        />

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
            Couldn&apos;t load handovers. {error}
          </div>
        )}

        {!loading && awaiting.length === 0 && !error && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            Nothing waiting — every logged handover is on the schedule.
          </p>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          {awaiting.map((h) => (
            <section
              key={h.jobId}
              style={{
                background: BRAND.card,
                border: `1px solid ${BRAND.line}`,
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
                  marginBottom: 6,
                }}
              >
                <a
                  href={`${HANDOVER_APP}/${encodeURIComponent(h.jobId)}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    color: BRAND.blue,
                    textDecoration: "none",
                  }}
                >
                  {h.jobId}
                </a>
                <span style={{ fontSize: 14 }}>{h.project || h.client || "—"}</span>
                <span style={{ fontSize: 12, color: BRAND.sub, marginLeft: "auto" }}>
                  {fmtDay(h.loggedAt) ? `logged ${fmtDay(h.loggedAt)}` : ""}
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 16,
                  flexWrap: "wrap",
                  fontSize: 13,
                  color: BRAND.sub,
                }}
              >
                <span>{h.totalSheets ? `${h.totalSheets} sheets` : "sheets —"}</span>
                <span>{h.totalM2 ? `${h.totalM2} m²` : "m² —"}</span>
                {h.product && <span>{h.product}</span>}
                {h.quantity !== "" && h.quantity != null && <span>qty {h.quantity}</span>}
                {h.attachmentCount > 0 && (
                  <span>
                    {h.attachmentCount} {h.attachmentCount === 1 ? "file" : "files"}
                  </span>
                )}
              </div>

              {h.processes?.length > 0 && (
                <p style={{ fontSize: 13, margin: "8px 0 0" }}>
                  {h.processes.join(" · ")}
                </p>
              )}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
