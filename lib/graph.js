import { ConfidentialClientApplication } from "@azure/msal-node";

// ---------------------------------------------------------------------------
// Microsoft Graph app-only auth (client credentials flow).
// Reads the production schedule from SharePoint using a service principal, so
// colleagues never have to log in — the app itself holds read-only access.
//
// Requires an Entra app registration with Sites.Selected (application) granted
// read access to the Projects SharePoint site. Fill the four env vars below in
// Vercel once IT completes the registration. Nothing else needs to change.
// ---------------------------------------------------------------------------

const TENANT_ID = process.env.AZURE_TENANT_ID;
const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;

// Graph identifiers for the SharePoint site + file. See lib/README for how to
// resolve these once. Hardcoding the file's driveId+itemId is the most robust
// path for a single known file (avoids per-request path lookups).
const SITE_HOSTNAME = "decorsystems.sharepoint.com";
const SITE_PATH = "/sites/Projects";
// Relative path within the site's default document library:
const FILE_PATH = "/- OTHER/Jordan/Production Schedule 2026 Current.xlsx";

let cca = null;
function client() {
  if (!cca) {
    if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
      throw new Error(
        "Missing Azure credentials. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET in the environment."
      );
    }
    cca = new ConfidentialClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        clientSecret: CLIENT_SECRET,
      },
    });
  }
  return cca;
}

async function token() {
  const result = await client().acquireTokenByClientCredential({
    scopes: ["https://graph.microsoft.com/.default"],
  });
  if (!result?.accessToken) throw new Error("Failed to acquire Graph token.");
  return result.accessToken;
}

async function graphGet(url, accessToken, asBuffer = false) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph GET ${res.status}: ${body.slice(0, 300)}`);
  }
  return asBuffer ? Buffer.from(await res.arrayBuffer()) : res.json();
}

// Resolve the site id, then the drive item for the file, then download bytes.
// The download-and-parse approach is deliberate: app-only access to the live
// workbook API is unreliable for files the app doesn't own, whereas reading the
// driveItem content stream works cleanly under Sites.Selected.
export async function downloadScheduleBuffer() {
  const accessToken = await token();

  const site = await graphGet(
    `https://graph.microsoft.com/v1.0/sites/${SITE_HOSTNAME}:${SITE_PATH}`,
    accessToken
  );

  const encodedPath = FILE_PATH.split("/").map(encodeURIComponent).join("/");
  const item = await graphGet(
    `https://graph.microsoft.com/v1.0/sites/${site.id}/drive/root:${encodedPath}`,
    accessToken
  );

  const buffer = await graphGet(
    `https://graph.microsoft.com/v1.0/sites/${site.id}/drive/items/${item.id}/content`,
    accessToken,
    true
  );

  return { buffer, lastModified: item.lastModifiedDateTime };
}
