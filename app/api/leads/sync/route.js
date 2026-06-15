/* POST /api/leads/sync — server-side sync from SpaceSeller → Supabase ss_orders. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SS_BASE = "https://drop.spaceseller.ma/api/v1";

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

async function fetchTrackedIds() {
  const url = `${process.env.SUPABASE_URL}/rest/v1/ss_tracked_ids?select=order_id&order=order_id.desc&limit=2000`;
  const r = await fetch(url, { headers: sbHeaders(), cache: "no-store" });
  if (!r.ok) return [];
  const arr = await r.json();
  return arr.map((row) => row.order_id);
}

async function fetchOrderFromSS(id) {
  const r = await fetch(`${SS_BASE}/orders/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${process.env.SPACESELLER_TOKEN || ""}`, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch { return { ok: false, status: r.status }; }
  if (r.ok && j?.success && j.data) return { ok: true, data: j.data };
  return { ok: false, status: r.status, error: j?.error || `HTTP ${r.status}` };
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
  if (!rows.length) return { inserted: 0 };
  const url = `${process.env.SUPABASE_URL}/rest/v1/ss_orders?on_conflict=order_id`;
  const r = await fetch(url, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`Supabase upsert HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return { inserted: rows.length };
}

async function processIds(ids) {
  const concurrency = 4;
  const okRows = [];
  const errors = [];
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(fetchOrderFromSS));
    results.forEach((r, k) => {
      if (r.ok) okRows.push(flatten(r.data));
      else errors.push({ id: batch[k], status: r.status });
    });
    await new Promise((rr) => setTimeout(rr, 250));
  }
  if (okRows.length) await upsertOrders(okRows);
  return { synced: okRows.length, errors: errors.length };
}

export async function POST(req) {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return withCors(Response.json({ success: false, error: "Supabase env vars not configured" }, { status: 500 }));
    }
    const u = new URL(req.url);
    const idsParam = u.searchParams.get("ids") || "";
    let ids = idsParam.split(/[,\s]+/).map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
    if (!ids.length) ids = await fetchTrackedIds();
    if (!ids.length) return withCors(Response.json({ success: true, message: "no tracked ids", synced: 0 }));
    const result = await processIds(ids);
    return withCors(Response.json({ success: true, requested: ids.length, ...result }));
  } catch (err) {
    return withCors(Response.json({ success: false, error: err.message || String(err) }, { status: 500 }));
  }
}

export const GET = POST;
