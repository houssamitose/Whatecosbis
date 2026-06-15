/* GET  /api/leads/ids    → current tracked IDs
   POST /api/leads/ids    body: { add?: number[], remove?: number[] }
   Maintains public.ss_tracked_ids server-side. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

function withCors(res) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function sbHeaders() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ""}`,
    "Content-Type": "application/json",
  };
}

export async function GET() {
  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/ss_tracked_ids?select=order_id&order=order_id.desc&limit=5000`,
      { headers: sbHeaders(), cache: "no-store" }
    );
    if (!r.ok) {
      const t = await r.text();
      return withCors(Response.json({ success: false, error: `Supabase HTTP ${r.status}: ${t.slice(0, 200)}` }, { status: r.status }));
    }
    const rows = await r.json();
    return withCors(Response.json({ success: true, count: rows.length, ids: rows.map((x) => x.order_id) }));
  } catch (err) {
    return withCors(Response.json({ success: false, error: err.message || String(err) }, { status: 500 }));
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const add = Array.isArray(body.add) ? body.add.map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n)) : [];
    const remove = Array.isArray(body.remove) ? body.remove.map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n)) : [];

    if (add.length) {
      const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/ss_tracked_ids?on_conflict=order_id`, {
        method: "POST",
        headers: { ...sbHeaders(), Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(add.map((order_id) => ({ order_id }))),
      });
      if (!r.ok) {
        const t = await r.text();
        return withCors(Response.json({ success: false, error: `Add failed: HTTP ${r.status}: ${t.slice(0, 200)}` }, { status: r.status }));
      }
    }
    if (remove.length) {
      const qs = `order_id=in.(${remove.join(",")})`;
      const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/ss_tracked_ids?${qs}`, {
        method: "DELETE",
        headers: { ...sbHeaders(), Prefer: "return=minimal" },
      });
      if (!r.ok) {
        const t = await r.text();
        return withCors(Response.json({ success: false, error: `Remove failed: HTTP ${r.status}: ${t.slice(0, 200)}` }, { status: r.status }));
      }
    }
    return withCors(Response.json({ success: true, added: add.length, removed: remove.length }));
  } catch (err) {
    return withCors(Response.json({ success: false, error: err.message || String(err) }, { status: 500 }));
  }
}
