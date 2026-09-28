"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { useCapabilities } from "../../lib/useCapabilities.js";

// Access — who can see and change what.
//
// It used to be five roles with two real levels: everything, or the floor. Ten
// of thirteen accounts could do everything, not because anybody decided that
// but because "manager" was the only setting that let somebody do their own
// job.
//
// Now it's the four areas the boards are grouped into, at a level each. A
// person holds any combination. Two things aren't areas and aren't pretending
// to be: scheduling is the committed dates, and admin is removing records and
// answering requests.

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

const AREAS = [
  {
    key: "production",
    label: "Production",
    levels: ["none", "view", "floor", "edit"],
    what: "Schedule board, allocation",
  },
  {
    key: "material",
    label: "Material",
    levels: ["none", "view", "edit"],
    what: "Orders, material list, handovers, dispatch",
  },
  {
    key: "warehouse",
    label: "Warehouse",
    levels: ["none", "view", "edit"],
    what: "Deliveries, stock, counting, packing",
  },
  {
    key: "money",
    label: "Money",
    levels: ["none", "view", "edit"],
    what: "Invoicing, off-the-shelf orders",
  },
];

const LEVEL_LABELS = {
  none: "—",
  view: "View",
  floor: "Floor",
  edit: "Edit",
};

function fmtStamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

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
const miniBtn = { ...btn, padding: "2px 8px", fontSize: 11, borderRadius: 6 };
const th = {
  textAlign: "left",
  fontSize: 11,
  color: BRAND.sub,
  fontWeight: 500,
  padding: "7px 10px",
  borderBottom: `1px solid ${BRAND.line}`,
  whiteSpace: "nowrap",
};
const td = {
  fontSize: 12,
  padding: "6px 10px",
  borderBottom: `1px solid ${BRAND.line}`,
  whiteSpace: "nowrap",
};

export default function AccessPage() {
  const [people, setPeople] = useState([]);
  // People who registered and are sitting outside, and anybody who has said
  // out loud that they can't get in. Both are somebody waiting on this screen.
  const [asks, setAsks] = useState([]);
  // What you're about to give a new person, before you've given it. The rest
  // of this page saves on every keystroke because it's changing what somebody
  // already has; letting somebody in for the first time is one deliberate act.
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [user, setUser] = useState(null);
  const caps = useCapabilities(user);

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setPeople([]);
        setError(null);
        return;
      }
      // This page sends the person's own token: the list is only for whoever
      // holds Admin, and the handover app is what decides that.
      const idToken = await current.getIdToken();
      const res = await fetch("/api/access", {
        headers: { Authorization: `Bearer ${idToken}` },
        cache: "no-store",
      });
      const json = await res.json();
      if (!json.ok) {
        throw new Error(
          json.error === "not_permitted_for_role"
            ? "Access is set by whoever holds Admin."
            : json.error || "Couldn't read the list"
        );
      }
      setPeople(json.people || []);
      setError(null);

      // The other half of "who's waiting": people already in, who've said on
      // the request board that something's shut to them.
      try {
        const asked = await fetch("/api/requests", { cache: "no-store" }).then((r) => r.json());
        setAsks(
          (asked.requests || []).filter(
            (r) => r.topic === "access" && r.status !== "done" && r.status !== "declined"
          )
        );
      } catch {
        // A request board that's down shouldn't take the access screen with it.
        setAsks([]);
      }
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, user]);

  const save = useCallback(
    async (person, next, clear = false, approveThem = false) => {
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first.");
        return;
      }
      setSaving(person.email);
      setActionError(null);
      try {
        const idToken = await current.getIdToken();
        const res = await fetch("/api/access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: person.email,
            access: next,
            clear,
            approve: approveThem,
            idToken,
          }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "That didn't save");
        await load();
      } catch (e) {
        setActionError(String(e.message || e));
      } finally {
        setSaving("");
      }
    },
    [load]
  );

  /**
   * Letting somebody in.
   *
   * Sends the areas and clears `pending` in the same call, because a person
   * who's been granted work they still can't reach is worse than one who was
   * never granted anything — nobody goes looking for a half-done approval.
   */
  const approve = useCallback(
    async (person) => {
      const next = draft[person.email] || person.access;
      await save(person, next, false, true);
      setDraft((d) => {
        const rest = { ...d };
        delete rest[person.email];
        return rest;
      });
    },
    [draft, save]
  );

  const me = user?.email?.toLowerCase();
  const waiting = people.filter((p) => p.role === "pending");
  const settled = people.filter((p) => p.role !== "pending");

  return (
    <main
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        background: BRAND.bg,
        color: BRAND.ink,
        minHeight: "100vh",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
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
              Access
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              Who can see and change what, by area
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            <SignIn user={user} brand={BRAND} />
            <button onClick={load} style={{ ...btn, padding: "6px 12px", fontSize: 13 }}>
              {loading ? "Reading…" : "Refresh"}
            </button>
          </div>
        </header>

        <Tabs current="access" tabs={caps.tabs} />

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
            {error}
          </div>
        )}

        {!user && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            Sign in to see who has what.
          </p>
        )}

        {/* Registered and sitting outside. Top of the page and in a warm
            border because it's the one thing here that's time-sensitive:
            everything below is a setting, this is a person waiting. */}
        {waiting.length > 0 && (
          <section
            style={{
              background: "#fdf4e6",
              border: `1px solid ${BRAND.amber}`,
              borderRadius: 10,
              padding: 14,
              marginBottom: 18,
            }}
          >
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 2px", color: BRAND.amber }}>
              Waiting for you ({waiting.length})
            </h2>
            <p style={{ fontSize: 12, color: BRAND.sub, margin: "0 0 12px" }}>
              Signed up and can&apos;t get in yet. Give them the areas they need — nothing is saved
              until you press the button, so a stray click doesn&apos;t let anybody in.
            </p>

            {waiting.map((person) => {
              const busy = saving === person.email;
              const next = draft[person.email] || person.access;
              const set = (patch) =>
                setDraft((d) => ({ ...d, [person.email]: { ...next, ...patch } }));
              return (
                <div
                  key={person.email}
                  style={{
                    background: BRAND.card,
                    border: `1px solid ${BRAND.line}`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    marginBottom: 8,
                    display: "flex",
                    gap: 14,
                    alignItems: "flex-end",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ minWidth: 190 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {person.name || person.email.split("@")[0]}
                    </div>
                    <div style={{ fontSize: 11, color: BRAND.sub }}>{person.email}</div>
                  </div>

                  {AREAS.map((area) => (
                    <label key={area.key} style={{ fontSize: 11, color: BRAND.sub }} title={area.what}>
                      <div style={{ marginBottom: 2 }}>{area.label}</div>
                      <select
                        value={next[area.key]}
                        onChange={(e) => set({ [area.key]: e.target.value })}
                        disabled={busy}
                        style={{
                          border: `1px solid ${BRAND.line}`,
                          borderRadius: 6,
                          padding: "3px 6px",
                          fontSize: 12,
                          fontFamily: "inherit",
                          background: next[area.key] === "edit" ? "#e6efe7" : BRAND.card,
                        }}
                      >
                        {area.levels.map((l) => (
                          <option key={l} value={l}>
                            {LEVEL_LABELS[l]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}

                  <label
                    style={{ fontSize: 11, color: BRAND.sub, display: "flex", gap: 5, alignItems: "center" }}
                    title="Committed dates and priority on the schedule board"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(next.scheduling)}
                      onChange={(e) => set({ scheduling: e.target.checked })}
                      disabled={busy}
                    />
                    Scheduling
                  </label>
                  <label
                    style={{ fontSize: 11, color: BRAND.sub, display: "flex", gap: 5, alignItems: "center" }}
                    title="Removing records and answering requests"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(next.admin)}
                      onChange={(e) => set({ admin: e.target.checked })}
                      disabled={busy}
                    />
                    Admin
                  </label>

                  <button
                    onClick={() => approve(person)}
                    disabled={busy}
                    style={{
                      ...btn,
                      background: BRAND.green,
                      borderColor: BRAND.green,
                      color: "#fff",
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    {busy ? "Letting them in…" : "Let them in"}
                  </button>
                </div>
              );
            })}

            <p style={{ fontSize: 11, color: BRAND.sub, margin: 0 }}>
              Letting somebody in also makes them an Operator in Decorflow, which is the clock and
              the floor screen and nothing more. Anybody who needs more of Decorflow itself gets it
              on the Team tab there. Turning somebody away is on that tab too — this screen only
              lets people in.
            </p>
          </section>
        )}

        {/* People already in, who've said something is shut to them. The
            request stays on the request board; it just also shows up where
            the fix is. */}
        {asks.length > 0 && (
          <section
            style={{
              background: BRAND.card,
              border: `1px solid ${BRAND.line}`,
              borderLeft: `3px solid ${BRAND.amber}`,
              borderRadius: 10,
              padding: "12px 14px",
              marginBottom: 18,
            }}
          >
            <h2 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>
              Asked for access ({asks.length})
            </h2>
            {asks.map((r) => (
              <div key={r.id} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: BRAND.sub }}>
                  {r.raisedBy ? r.raisedBy.split("@")[0] : "someone"} · {fmtStamp(r.raisedAt)}
                  {r.screen ? ` · ${r.screen}` : ""}
                </div>
                <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{r.text}</div>
              </div>
            ))}
            <a href="/requests" style={{ fontSize: 12, color: BRAND.blue }}>
              Answer these on the request board →
            </a>
          </section>
        )}

        {settled.length > 0 && (
          <>
            <div
              style={{
                background: BRAND.card,
                border: `1px solid ${BRAND.line}`,
                borderRadius: 10,
                overflowX: "auto",
              }}
            >
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={th}>Person</th>
                    {AREAS.map((a) => (
                      <th key={a.key} style={th} title={a.what}>
                        {a.label}
                      </th>
                    ))}
                    <th style={th} title="Committed dates and priority on the schedule board">
                      Scheduling
                    </th>
                    <th style={th} title="Removing records and answering requests">
                      Admin
                    </th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {settled.map((person) => {
                    const busy = saving === person.email;
                    const set = (patch) => save(person, { ...person.access, ...patch });
                    return (
                      <tr key={person.email}>
                        <td style={td}>
                          <span style={{ fontWeight: 600 }}>{person.name || person.email}</span>
                          <div style={{ fontSize: 11, color: BRAND.sub }}>
                            {person.email}
                            {/* Which of the two you're looking at: a decision
                                somebody made, or what their old role happens
                                to imply. */}
                            {!person.granted && (
                              <span style={{ color: BRAND.amber }}>
                                {" "}
                                · from their old role ({person.role || "none"})
                              </span>
                            )}
                          </div>
                        </td>
                        {AREAS.map((area) => (
                          <td key={area.key} style={td}>
                            <select
                              value={person.access[area.key]}
                              onChange={(e) => set({ [area.key]: e.target.value })}
                              disabled={busy}
                              style={{
                                border: `1px solid ${BRAND.line}`,
                                borderRadius: 6,
                                padding: "3px 6px",
                                fontSize: 12,
                                fontFamily: "inherit",
                                background:
                                  person.access[area.key] === "edit"
                                    ? "#e6efe7"
                                    : person.access[area.key] === "none"
                                      ? BRAND.card
                                      : "#f3f1ea",
                              }}
                            >
                              {area.levels.map((l) => (
                                <option key={l} value={l}>
                                  {LEVEL_LABELS[l]}
                                </option>
                              ))}
                            </select>
                          </td>
                        ))}
                        <td style={{ ...td, textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={Boolean(person.access.scheduling)}
                            onChange={(e) => set({ scheduling: e.target.checked })}
                            disabled={busy}
                            aria-label={`Scheduling for ${person.name}`}
                          />
                        </td>
                        <td style={{ ...td, textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={Boolean(person.access.admin)}
                            onChange={(e) => set({ admin: e.target.checked })}
                            // Taking Admin off yourself is the one move that
                            // can't be undone by the person making it.
                            disabled={busy || person.email.toLowerCase() === me}
                            title={
                              person.email.toLowerCase() === me
                                ? "You can't take Admin off yourself"
                                : undefined
                            }
                            aria-label={`Admin for ${person.name}`}
                          />
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {person.granted && (
                            <button
                              onClick={() => save(person, person.access, true)}
                              disabled={busy}
                              title="Back to whatever their old role implies"
                              style={{ ...miniBtn, color: BRAND.sub }}
                            >
                              Reset
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ fontSize: 12, color: BRAND.sub, marginTop: 14, maxWidth: 760 }}>
              <p style={{ margin: "0 0 6px" }}>
                <strong style={{ color: BRAND.ink }}>View</strong> sees the boards in that area and
                changes nothing. <strong style={{ color: BRAND.ink }}>Edit</strong> does the work in
                it. <strong style={{ color: BRAND.ink }}>Floor</strong> is production only: ticking a
                job forward as you finish with it, without being able to move the dates it&apos;s
                committed to.
              </p>
              <p style={{ margin: 0 }}>
                Anybody marked <em>from their old role</em> hasn&apos;t been given areas yet and
                keeps exactly what that role always gave them. Changing a dropdown is what decides
                it for them.
              </p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
