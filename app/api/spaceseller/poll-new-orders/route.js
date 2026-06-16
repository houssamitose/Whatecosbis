/* POST /api/spaceseller/poll-new-orders
   Serverless equivalent of the Chrome-MCP scheduled task.

   Strategy:
     1. Read the max order_id currently in ss_orders.
     2. Try fetching order_id+1, +2, +3, ... via SpaceSeller's public API.
     3. Each successful fetch → upsert into ss_orders.
     4. Stop after N consecutive 404s (means we've reached the gap or the end).
     5. Cap total attempts to avoid infinite loops / Vercel function timeout.

   No SpaceSeller browser session required — uses SPACESELLER_TOKEN env var.
   Designed to be triggered by Vercel cron every 30 minutes.

   GET also supported (same behaviour) so Vercel cron can call it without body.
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

async function getMaxTrackedId() {
  const url = `${SB}/rest/v1/ss_orders?select=order_id&order=order_id.desc&limit=1`;
  const r = await fetch(url, { headers: sbHeaders(), cache: "no-store" });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.order_id || null;
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
  if (!r.ok) throw new Error(`Supabase upsert HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return rows.length;
}

async function addToTracked(ids) {
  if (!ids.length) return 0;
  const r = await fetch(`${SB}/rest/v1/ss_tracked_ids?on_conflict=order_id`, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(ids.map((order_id) => ({ order_id }))),
  });
  return r.ok ? ids.length : 0;
}

async function poll() {
  if (!SS_TOKEN) throw new Error("SPACESELLER_TOKEN not configured");
  const maxId = await getMaxTrackedId();
  if (!maxId) throw new Error("No max order_id in ss_orders");

  const MAX_GAP = 5;            /* Stop after N consecutive 404s */
  const MAX_ATTEMPTS = 80;      /* Hard cap to fit Vercel 10s timeout */
  const newRows = [];
  let consecutive404 = 0;
  let id = maxId;
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS && consecutive404 < MAX_GAP) {
    id++;
    attempts++;
    const r = await fetchOrderFromSS(id);
    if (r.ok) {
      newRows.push(flatten(r.data));
      consecutive404 = 0;
    } else if (r.status === 404 || r.status === 403) {
      consecutive404++;
    } else {
      /* Server error — skip but don't reset gap */
      consecutive404++;
    }
    /* small delay to be polite to SpaceSeller */
    await new Promise((rr) => setTimeout(rr, 100));
  }

  const inserted = await upsertOrders(newRows);
  await addToTracked(newRows.map((r) => r.order_id));

  return {
    startFromId: maxId,
    lastProbedId: id,
    attempts,
    found: newRows.length,
    inserted,
    stoppedReason: consecutive404 >= MAX_GAP ? "gap_exceeded" : "max_attempts",
  };
}

export async function POST() {
  if (!SB || !KEY) {
    return Response.json({ success: false, error: "Supabase env vars not configured" }, { status: 500, headers: CORS });
  }
  try {
    const out = await poll();
    return Response.json({ success: true, ...out }, { headers: CORS });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500, headers: CORS });
  }
}

export const GET = POST;
