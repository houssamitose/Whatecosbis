/* POST /api/spaceseller/refresh-statuses
   Re-fetches statuses for orders already in ss_orders, via the SpaceSeller
   public API (token-based, NO session needed).

   Strategy:
     1. Read the N most-recently-updated orders from ss_orders (default 25).
     2. For each, call GET /api/v1/orders/{id} with the token.
     3. Upsert the fresh status data.

   Designed to fit Vercel's 10s timeout — defaults to 25 per call. Run every
   30 min via cron to keep all 752+ orders fresh (rolling refresh).

   Query params:
     ?limit=N         max orders to refresh in this call (default 25, max 50)
     ?since=YYYY-MM-DD  only consider orders with date_order >= since
*/

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SS_TOKEN = process.env.SPACESELLER_TOKEN;
const SS_BASE = "https://drop.spaceseller.ma/api/v1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

function sbHeaders() {
  return {
    apikey: KEY || "",
    Authorization: `Bearer ${KEY || ""}`,
    "Content-Type": "application/json",
  };
}

async function fetchOrderIds(limit, since) {
  const params = new URLSearchParams();
  params.set("select", "order_id");
  /* Order by synced_at ascending so we round-robin oldest first */
  params.set("order", "synced_at.asc");
  params.set("limit", String(limit));
  if (since) params.set("date_order", `gte.${since}`);
  const url = `${SB}/rest/v1/ss_orders?${params}`;
  const r = await fetch(url, { headers: sbHeaders(), cache: "no-store" });
  if (!r.ok) throw new Error(`Supabase HTTP ${r.status}`);
  const rows = await r.json();
  return rows.map((row) => row.order_id);
}

async function fetchOrderFromSS(id) {
  const r = await fetch(`${SS_BASE}/orders/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${SS_TOKEN || ""}`, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch { return { ok: false, status: r.status }; }
  if (r.ok && j?.success && j.data) return { ok: true, data: j.data };
  return { ok: false, status: r.status };
}

function flatten(o) {
  return {
    order_id: o.order_id,
    uuid: o.uuid || null,
    fullname: o.fullname || null,
    phone: o.phone || null,
    second_phone: o.second_phone || null,
    address: o.address || null,
    city: o.city || null,
    id_city: o.id_city || null,
    note: o.note || null,
    total_price: parseFloat(o.total_price || 0),
    tracking_number: o.tracking_number || null,
    order_status_code: o.order_status?.code || null,
    order_status_label: o.order_status?.label || null,
    delivery_status_code: o.delivery_status?.code || null,
    delivery_status_label: o.delivery_status?.label || null,
    date_order: o.date_order || null,
    date_confirmation: o.date_confirmation || null,
    date_delivery: o.date_delivery || null,
    products: o.products || [],
    order_status_history: o.order_status_history || [],
    delivery_status_history: o.delivery_status_history || [],
    raw_payload: o,
    synced_at: new Date().toISOString(),
  };
}

async function upsertOrders(rows) {
  if (!rows.length) return 0;
  const url = `${SB}/rest/v1/ss_orders?on_conflict=order_id`;
  const r = await fetch(url, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`Supabase upsert HTTP ${r.status}`);
  return rows.length;
}

async function refresh(limit, since) {
  if (!SS_TOKEN) throw new Error("SPACESELLER_TOKEN missing");
  const ids = await fetchOrderIds(limit, since);
  const rows = [];
  let errors = 0;
  /* small concurrency to fit Vercel 10s timeout */
  const concurrency = 4;
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(fetchOrderFromSS));
    results.forEach((r) => {
      if (r.ok) rows.push(flatten(r.data));
      else errors++;
    });
    await new Promise((rr) => setTimeout(rr, 150));
  }
  const inserted = await upsertOrders(rows);
  return { requested: ids.length, refreshed: rows.length, errors, inserted };
}

async function handle(req) {
  if (!SB || !KEY) {
    return Response.json({ success: false, error: "Supabase env vars not configured" }, { status: 500, headers: CORS });
  }
  try {
    const u = new URL(req.url);
    const limit = Math.min(parseInt(u.searchParams.get("limit") || "25", 10), 50);
    const since = u.searchParams.get("since") || null;
    const out = await refresh(limit, since);
    return Response.json({ success: true, ...out }, { headers: CORS });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500, headers: CORS });
  }
}

export const GET = handle;
export const POST = handle;
