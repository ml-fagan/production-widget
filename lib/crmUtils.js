// Shared, browser-safe CRM string helpers — no Node-only imports here (no
// "crypto", no "xlsx"), so this can be imported from client components as
// well as server code. token.js and parseSchedule.js both import from here
// instead of keeping their own copies, so the two never drift apart.

// Strip ALL trailing -N part suffixes (however many levels deep), keeping any
// letter suffix like 17232b, to the base project id — every part, and every
// sub-part of a part, always groups under the top-level job number.
// Examples: "21811-2" -> "21811"; "17232b-3" -> "17232b"; "19498" -> "19498";
// "19289-1-1" -> "19289"; "19289-1-2" -> "19289".
export function baseCrm(crm) {
  return String(crm).trim().toLowerCase().replace(/(-\d+)+$/, "");
}

// e.g. 21222-1, 17630, 17232b-3, 9967-6, 19289-2-1 (a part split into sub-parts)
export function crmLooksValid(v) {
  return /^\d{3,6}[a-z]?(-\d+)*$/i.test(String(v ?? "").trim());
}
