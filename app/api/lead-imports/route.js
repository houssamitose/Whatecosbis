/* GET /api/lead-imports
   Returns the imports log (paginated, newest first).
   Query: ?status=pending|sent|failed|duplicate  ?limit=200  ?source=gsheet
   PATCH /api/lead-imports  body: { id, action: 'retry'|'delete' }
*/

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

function sbHeaders(extra = {}) {
  return {
    apikey: KEY || "",
    Authorization: `Bearer ${KEY || ""}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function GET(req) {
  if (!SB || !KEY) {
    return Response.json({ success: false, error: "Supabase env vars not configured" }, { status: 500, headers: CORS });
  }
  try {
    const u = new URL(req.url);
    const status = u.searchParams.get("status");
    const source = u.searchParams.get("source");
    const limit = Math.min(parseInt(u.searchParams.get("limit") || "200", 10), 1000);
    const p = new URLSearchParams();
    p.set("select", "*");
    p.set("order", "created_at.desc");
    p.set("limit", String(limit));
    if (status) p.set("status", `eq.${status}`);
    if (source) p.set("source", `eq.${source}`);
    const r = await fetch(`${SB}/rest/v1/crm_lead_imports?${p}`, { headers: sbHeaders(), cache: "no-store" });
    if (!r.ok) {
      const t = await r.text();
      return Response.json({ success: false, error: `Supabase HTTP ${r.status}`, body: t.slice(0, 300) }, { status: r.status, headers: CORS });
    }
    const rows = await r.json();
    /* Aggregates */
    const counts = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status]||0)+1; return acc; }, {});
    return Response.json({ success: true, count: rows.length, counts, imports: rows }, { headers: CORS });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500, headers: CORS });
  }
}
