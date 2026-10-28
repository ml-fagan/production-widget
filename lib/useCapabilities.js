"use client";

import { useEffect, useState } from "react";
import { auth, firebaseConfigured } from "./firebaseClient.js";

/**
 * What this person may change, so a board can stop offering what it can't do.
 *
 * Comes from the role assigned in ProFlow's Team tab — one place, and the
 * same role the Firestore rules read.
 *
 * Optimistic while it loads and on any failure: the write endpoints decide,
 * and greying out Alice's own board because a lookup was slow would be worse
 * than showing a button that turns out to be refused.
 */
const EVERYTHING = {
  processSteps: true,
  schedule: true,
  // Confirming a delivery out the back. Its own right, not part of materials:
  // signing for what arrived isn't deciding what to buy.
  receiving: true,
  // Putting people on machines — Adam's board.
  allocation: true,
  materials: true,
  invoicing: true,
  handover: true,
  manage: true,
  // Chasing a drawing set. Optimistic like the rest — the route decides.
  drafting: true,
  /**
   * Stamping nest sheets on the floor's job page.
   *
   * False even in the optimistic case, unlike everything else here. The rest
   * of this object errs towards showing a control that a write endpoint may
   * then refuse, because greying out somebody's own board over a slow lookup
   * is the worse failure. This one errs the other way: it gates a whole tab
   * that most people should never see, and flashing it up for everyone on
   * every page load before the server corrects it would be the thing people
   * notice.
   */
  stamping: false,
  // Every board, because the feed is behind the staff password and reading
  // one has never been the restricted part. `access` is deliberately absent:
  // it's the only screen here that isn't for everybody, so it is the only one
  // that waits for the server to say so rather than being assumed and taken
  // back a moment later.
  tabs: ["schedule", "board", "materials", "warehouse", "stock", "materiallist", "allocation", "drafting", "invoicing", "shelforders", "costing", "requests", "activity", "handover"],
};

const NOTHING = { ...EVERYTHING, processSteps: false, schedule: false, receiving: false, allocation: false, materials: false, invoicing: false, handover: false, manage: false, drafting: false, stamping: false };

export function useCapabilities(user) {
  const [can, setCan] = useState(EVERYTHING);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const current = firebaseConfigured() ? auth().currentUser : null;
        if (!current) {
          // Signed out: every board still shows everything, nothing is editable.
          if (active) setCan(NOTHING);
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
