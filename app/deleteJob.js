"use client";

import { auth, firebaseConfigured } from "../lib/firebaseClient.js";

/**
 * Deletes a job for good, after making the person type its number.
 *
 * Shared by the schedule board, the material orders board and the invoicing
 * board so the warning reads the same wherever it's triggered — the
 * consequences don't change with which screen you happened to be on.
 *
 * Typing the number rather than clicking OK is deliberate: rows are one line
 * apart, there's no undo, and this takes a job off every board at once.
 *
 * Returns { ok } on success, { cancelled } if the person backed out, or
 * { error } with something worth showing.
 */
export async function confirmAndDeleteJob(row) {
  const current = firebaseConfigured() ? auth().currentUser : null;
  if (!current) {
    return { error: "Sign in to delete a job — it's recorded against your name." };
  }

  const label = row.project || row.client || "no project";
  const typed = window.prompt(
    [
      `Delete ${row.jobId} (${label}) for good?`,
      "",
      "It disappears from the schedule board, material orders, invoicing and " +
        "the handovers list, and its client link stops working. This can't be undone.",
      "",
      "Type the job number to confirm:",
    ].join("\n")
  );

  if (typed === null) return { cancelled: true };
  if (typed.trim() !== row.jobId) {
    return { error: `Not deleted — "${typed.trim()}" doesn't match ${row.jobId}.` };
  }

  try {
    const idToken = await current.getIdToken();
    const res = await fetch("/api/handovers-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: row.jobId, idToken }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Delete failed");
    return { ok: true };
  } catch (e) {
    return { error: `Couldn't delete ${row.jobId}. ${String(e.message || e)}` };
  }
}

/** The link styling every Delete uses, so they read as the same action. */
export const deleteLinkStyle = {
  background: "none",
  border: "none",
  color: "#a3312c",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
  padding: 0,
};
