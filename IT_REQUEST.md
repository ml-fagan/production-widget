# IT request — Entra app registration for read-only production feed

Send this to whoever manages the Azure/Entra tenant (the same admin who handled
the Decordigest OAuth). It's a smaller ask than that one: read-only, one file,
no mailbox.

---

**Subject:** App registration request — read-only access to one SharePoint file

Hi [IT admin],

I've built an internal web page that displays our factory production schedule as
a live feed the team can pin to their desktops. It needs to read a single
SharePoint file on a schedule, so it needs its own app identity rather than
signing in as me.

Could you please register an app in Entra with the following — it's least-
privilege and read-only:

- **App registration** (single tenant) — name e.g. "Production Feed (read-only)"
- **Application permission:** `Sites.Selected` (Microsoft Graph)
- **Grant that app read access to one site only:** the **Projects** site
  (`decorsystems.sharepoint.com/sites/Projects`) — read (not write). This is done
  with a one-line Graph/PowerShell grant against the site once the app exists.
- **A client secret** (12-month expiry is fine)

Then send me: the **tenant ID**, the **application (client) ID**, and the
**client secret value**. I'll put them into the app's hosting config myself —
they don't need to go anywhere else.

What this does **not** need, to be explicit:
- No mailbox / email access
- No write access to anything
- No access to any other site or the wider SharePoint/OneDrive
- No user sign-in on behalf of anyone

The app only ever reads one file:
`Projects > Shared Documents > - OTHER > Jordan > Production Schedule 2026 Current.xlsx`

Happy to jump on a quick call if easier. Thanks!

[Your name]

---

## For the admin — the exact grant (optional, saves them looking it up)

After creating the app registration and adding the `Sites.Selected` application
permission (with admin consent), grant it read on just the Projects site:

```
PATCH https://graph.microsoft.com/v1.0/sites/{projects-site-id}/permissions
```

or via PnP PowerShell:

```powershell
Grant-PnPAzureADAppSitePermission `
  -AppId "<application-client-id>" `
  -DisplayName "Production Feed (read-only)" `
  -Site "https://decorsystems.sharepoint.com/sites/Projects" `
  -Permissions Read
```
