import crypto from "crypto";

// ---------------------------------------------------------------------------
// Deterministic, unguessable per-PROJECT tokens.
//
// A project is identified by its BASE crm (e.g. 21811), and may have parts
// 21811-1, 21811-2, ... Each part tracks its own stages and dispatch date, but
// they all share ONE client link keyed to the base. So token(21811-1) and
// token(21811-2) both resolve to the same project page, which stacks the parts.
//
// token(crm) = first 12 hex of HMAC-SHA256(baseCrm, LINK_SECRET).
// Stable for the life of the project; unguessable without LINK_SECRET.
// ---------------------------------------------------------------------------

const SECRET = process.env.LINK_SECRET || "";

// Strip a trailing -N (and any letter suffix like 17232b) to the base project id.
// Examples: "21811-2" -> "21811"; "17232b-3" -> "17232b"; "19498" -> "19498".
export function baseCrm(crm) {
  return String(crm).trim().toLowerCase().replace(/-\d+$/, "");
}

export function tokenForCrm(crm) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(baseCrm(crm))
    .digest("hex")
    .slice(0, 12);
}

// Find ALL parts (jobs) whose base CRM produces this token.
export function findPartsByToken(jobs, token) {
  const t = String(token).trim().toLowerCase();
  return jobs.filter((j) => tokenForCrm(j.crm) === t);
}
