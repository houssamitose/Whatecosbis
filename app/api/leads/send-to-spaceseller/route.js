/* POST /api/leads/send-to-spaceseller
   Sends a lead to SpaceSeller's POST /api/v1/orders, stores the result.

   Body (single lead):
     { fullname, phone, address, city?, product_ref, qte, price,
       second_phone?, note?, source?, source_ref?, raw? }
   OR bulk: { items: [...] }

   Flow:
     1. Hash the lead → de-dupe via crm_lead_imports.id
     2. Insert pending row
     3. POST to SpaceSeller /api/v1/orders
     4. Save returned order_id → spaceseller_order_id
     5. Also add to ss_tracked_ids so existing sync pipeline picks it up
*/

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SS_TOKEN = process.env.SPACESELLER_TOKEN;
const SS_BASE = "https://drop.spaceseller.ma/api/v1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
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

/* Stable hash so the same lead row never gets sent twice */
async function hashLead(l) {
  const key = [l.fullname, l.phone, l.product_ref, l.qte, l.price, l.address].join("|").toLowerCase();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return "li_" + Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

async function findProductIdBySku(ref) {
  if (!ref) return null;
  const r = await fetch(
    `${SB}/rest/v1/crm_products?select=id&tracking_code=eq.${encodeURIComponent(ref)}&limit=1`,
    { headers: sbHeaders(), cache: "no-store" }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0]?.id || null;
}

async function existsAlready(id) {
  const r = await fetch(
    `${SB}/rest/v1/crm_lead_imports?select=id,status,spaceseller_order_id&id=eq.${encodeURIComponent(id)}&limit=1`,
    { headers: sbHeaders(), cache: "no-store" }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}

async function insertImport(row) {
  const r = await fetch(`${SB}/rest/v1/crm_lead_imports?on_conflict=id`, {
    method: "POST",
    headers: sbHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify([row]),
  });
  if (!r.ok) throw new Error(`Insert import HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function updateImport(id, patch) {
  await fetch(`${SB}/rest/v1/crm_lead_imports?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
}

async function trackOrderId(orderId) {
  if (!orderId) return;
  await fetch(`${SB}/rest/v1/ss_tracked_ids?on_conflict=order_id`, {
    method: "POST",
    headers: sbHeaders({ Prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify([{ order_id: orderId }]),
  });
}

async function postOnce(payload) {
  const r = await fetch(`${SS_BASE}/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SS_TOKEN || ""}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  return { ok: r.ok, status: r.status, body, payloadSent: payload };
}

async function postToSpaceSeller(lead) {
  /* Try FLAT format first — matches user's Google Sheet structure (7 columns). */
  const flat = {
    date_order: lead.date_order || new Date().toISOString().slice(0, 19).replace("T", " "),
    fullname: lead.fullname,
    phone: lead.phone,
    second_phone: lead.second_phone || "",
    address: lead.address || "",
    city: lead.city || "",
    note: lead.note || "",
    product_ref: lead.product_ref,
    qte: parseInt(lead.qte, 10) || 1,
    price: parseFloat(lead.price) || 0,
  };
  let r = await postOnce(flat);
  if (r.ok) return r;
  /* Fallback: NESTED format with products[] array (Laravel-ish convention) */
  const nested = {
    fullname: lead.fullname,
    phone: lead.phone,
    second_phone: lead.second_phone || "",
    address: lead.address || "",
    city: lead.city || "",
    note: lead.note || "",
    date_order: lead.date_order || undefined,
    products: [{
      ref: lead.product_ref,
      qte: parseInt(lead.qte, 10) || 1,
      price: parseFloat(lead.price) || 0,
    }],
  };
  const r2 = await postOnce(nested);
  /* Return whichever was closer to success, with full debug info */
  if (r2.ok) return r2;
  return { ok: false, status: r2.status, body: r2.body, attempts: { flat: r, nested: r2 } };
}

async function processLead(lead) {
  if (!lead.fullname || !lead.phone || !lead.product_ref) {
    return { ok: false, error: "Missing required field (fullname/phone/product_ref)" };
  }
  const id = await hashLead(lead);
  const existing = await existsAlready(id);
  if (existing && existing.status === "sent" && existing.spaceseller_order_id) {
    return { ok: true, id, status: "duplicate", spaceseller_order_id: existing.spaceseller_order_id };
  }
  const product_id = await findProductIdBySku(lead.product_ref);
  await insertImport({
    id,
    source: lead.source || "form",
    source_ref: lead.source_ref || null,
    fullname: lead.fullname,
    phone: lead.phone,
    address: lead.address || null,
    city: lead.city || null,
    product_ref: lead.product_ref,
    product_id: product_id ? null : null, /* product_id is bigint, our crm_products.id is text — leave null for now */
    qte: parseInt(lead.qte, 10) || 1,
    price: parseFloat(lead.price) || 0,
    raw_payload: lead.raw || lead,
    status: "pending",
  });
  const out = await postToSpaceSeller(lead);
  if (!out.ok) {
    await updateImport(id, {
      status: "failed",
      error: `HTTP ${out.status}: ${JSON.stringify(out.body).slice(0, 300)}`,
      spaceseller_response: out.body,
    });
    return { ok: false, id, status: "failed", error: out.body };
  }
  /* Extract order_id from many possible response shapes */
  const b = out.body || {};
  const ssOrderId =
    b.data?.order_id ||
    b.order_id ||
    b.id ||
    b.data?.id ||
    b.result?.order_id ||
    b.result?.id ||
    b.order?.id ||
    b.order?.order_id ||
    null;
  await updateImport(id, {
    status: "sent",
    sent_at: new Date().toISOString(),
    spaceseller_order_id: ssOrderId,
    spaceseller_response: out.body,
  });
  if (ssOrderId) await trackOrderId(ssOrderId);
  return { ok: true, id, status: "sent", spaceseller_order_id: ssOrderId };
}

export async function POST(req) {
  if (!SB || !KEY || !SS_TOKEN) {
    return Response.json({ success: false, error: "Env vars missing" }, { status: 500, headers: CORS });
  }
  try {
    const body = await req.json();
    const items = Array.isArray(body) ? body : body.items ? body.items : [body];
    const results = [];
    for (const lead of items) {
      const out = await processLead(lead);
      results.push(out);
    }
    const stats = {
      sent: results.filter((r) => r.status === "sent").length,
      duplicates: results.filter((r) => r.status === "duplicate").length,
      failed: results.filter((r) => r.status === "failed").length,
    };
    return Response.json({ success: true, total: items.length, ...stats, results }, { headers: CORS });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500, headers: CORS });
  }
}
