import { tokenForCrm } from "../../../lib/token.js";
import { crmLooksValid } from "../../../lib/crmUtils.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Same base URL the per-row Copy links use — see app/api/schedule/route.js.
const TRACKER_BASE = process.env.TRACKER_BASE_URL || "";

// Pure compute against the same tokenForCrm() the rest of the app already
// uses — no SharePoint/Graph call here, so this stays fast and doesn't need
// to re-read or re-parse the schedule just to mint a link.
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const crm = String(searchParams.get("crm") ?? "").trim();

  if (!crm) {
    return Response.json({ ok: false, error: "Enter a CRM number." }, { status: 400 });
  }
  if (!crmLooksValid(crm)) {
    return Response.json({ ok: false, error: "Doesn't look like a valid CRM number." }, { status: 400 });
  }
  if (!TRACKER_BASE) {
    return Response.json({ ok: false, error: "TRACKER_BASE_URL isn't configured." }, { status: 500 });
  }

  const link = `${TRACKER_BASE.replace(/\/$/, "")}/p/${tokenForCrm(crm)}`;
  return Response.json({ ok: true, crm, link }, { headers: { "Cache-Control": "no-store" } });
}
