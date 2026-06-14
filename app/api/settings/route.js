/* /api/settings
   GET   → returns the single 'global' row
   PATCH → updates fields on the global row
*/

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sb(extra = {}) {
  return {
    apikey: KEY || "",
    Authorization: `Bearer ${KEY || ""}`,
    "Content-Type": "application/json",
    ...extra,
  };
}
function need() {
  if (!SB || !KEY) {
    return Response.json(
      { success: false, error: "Supabase env vars not configured" },
      { status: 500 }
    );
  }
  return null;
}

export async function GET() {
  const g = need();
  if (g) return g;
  try {
    const r = await fetch(`${SB}/rest/v1/crm_settings?id=eq.global&select=*`, {
      headers: sb(),
      cache: "no-store",
    });
    if (!r.ok) {
      const t = await r.text();
      return Response.json(
        { success: false, error: `Supabase HTTP ${r.status}`, body: t.slice(0, 300) },
        { status: r.status }
      );
    }
    const rows = await r.json();
    return Response.json({ success: true, settings: rows[0] || null });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500 });
  }
}

export async function PATCH(req) {
  const g = need();
  if (g) return g;
  try {
    const body = await req.json();
    const allowed = [
      "low_stock_threshold",
      "theme",
      "currency",
      "spaceseller_token_id",
      "business_name",
      "business_logo",
      "business_email",
      "business_phone",
      "extras",
    ];
    const clean = {};
    for (const k of allowed) if (body[k] !== undefined) clean[k] = body[k];
    /* camelCase aliases */
    if (body.lowStockThreshold !== undefined) clean.low_stock_threshold = body.lowStockThreshold;
    if (body.businessName !== undefined) clean.business_name = body.businessName;
    if (body.businessLogo !== undefined) clean.business_logo = body.businessLogo;
    if (body.businessEmail !== undefined) clean.business_email = body.businessEmail;
    if (body.businessPhone !== undefined) clean.business_phone = body.businessPhone;
    if (!Object.keys(clean).length) {
      return Response.json({ success: false, error: "Nothing to patch" }, { status: 400 });
    }
    const r = await fetch(`${SB}/rest/v1/crm_settings?id=eq.global`, {
      method: "PATCH",
      headers: sb({ Prefer: "return=representation" }),
      body: JSON.stringify(clean),
    });
    if (!r.ok) {
      const t = await r.text();
      return Response.json(
        { success: false, error: `Supabase HTTP ${r.status}`, body: t.slice(0, 300) },
        { status: r.status }
      );
    }
    const rows = await r.json();
    return Response.json({ success: true, settings: rows[0] || null });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500 });
  }
}
