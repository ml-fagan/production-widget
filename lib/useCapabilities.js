"use client";

import { useEffect, useState } from "react";
import { auth, firebaseConfigured } from "./firebaseClient.js";

/**
 * What this person may change, so a board can stop offering what it can't do.
 *
 * Optimistic while it loads and on any failure: the write endpoints decide,
 * and greying out Alice's own board because a lookup was slow would be worse
 * than showing a button that turns out to be refused.
 */
export function useCapabilities(user) {
  const [can, setCan] = useState({ materials: true, invoicing: true });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const current = firebaseConfigured() ? auth().currentUser : null;
        if (!current) {
          // Signed out: every board still shows everything, nothing is editable.
          if (active) setCan({ materials: false, invoicing: false });
          return;
        }
        const idToken = await current.getIdToken();
        const res = await fetch("/api/me", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        const json = await res.json();
        if (active && json.ok) setCan(json.can);
      } catch {
        // Left as it was — optimistic.
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  return can;
}
