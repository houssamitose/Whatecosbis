/* POST /api/products/aggregate-metrics
   Reads all ss_orders, groups by products[].ref, computes:
     - ordered:   count of orders that contain this SKU
     - confirmed: count where order_status_code = 'CONFIRMED'
     - delivered: count where delivery_status_code = 'P_DELIVERED'
     - revenue:   sum of products[].price * products[].qte (for confirmed orders)
   Then PATCHes each matching crm_product with these metrics.

   GET also supported — returns the aggregation without writing (preview).
   Triggered nightly via Vercel cron defined in vercel.json.
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

/* SpaceSeller order status codes that mean "call center confirmed the order"
   (i.e. counted as Confirmed in their dashboard widget). Anything else
   (BLACKLISTED, CANCELED, FAUXCOMMANDE, RECHECK_CANCEL, etc.) is rejected. */
const CONFIRMED_STATUSES = new Set([
  "PAID",
  "PROCESSED",
  "PRODUCTRETURNED",
  "DELAYED",
  "RAPPEL1",
  "RAPPEL2",
  "RAPPEL3",
  "RAPPEL4",
  "RECHECK_REPORTER",
  "RECHECK_REPORTER_02",
]);

async function aggregate() {
  /* Fetch ALL ss_orders with products + statuses. PostgREST default limit is 1000; bump it. */
  const url = `${SB}/rest/v1/ss_orders?select=order_id,products,order_status_code,delivery_status_code&limit=20000`;
  const r = await fetch(url, { headers: sb(), cache: "no-store" });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Supabase HTTP ${r.status}: ${t.slice(0, 200)}`);
  }
  const rows = await r.json();
  /* Aggregate by ref + capture product names for auto-creation */
  const byRef = {};
  const nameByRef = {};
  for (const row of rows) {
    const products = Array.isArray(row.products) ? row.products : [];
    /* Dedupe products within a single order by ref so we don't double-count */
    const refsInOrder = new Set();
    for (const p of products) {
      if (p?.ref) {
        refsInOrder.add(p.ref);
        if (!nameByRef[p.ref] && p.name) nameByRef[p.ref] = p.name;
      }
    }
    const isConfirmed = CONFIRMED_STATUSES.has(row.order_status_code);
    const isDelivered = row.delivery_status_code === "P_DELIVERED";
    for (const ref of refsInOrder) {
      const a = byRef[ref] || { ordered: 0, confirmed: 0, delivered: 0, revenue: 0 };
      a.ordered += 1;
      if (isConfirmed) a.confirmed += 1;
      if (isDelivered) a.delivered += 1;
      if (isConfirmed) {
        const matched = products.filter((p) => p.ref === ref);
        for (const p of matched) {
          const price = parseFloat(p.price) || 0;
          const qte = parseInt(p.qte, 10) || 1;
          a.revenue += price * qte;
        }
      }
      byRef[ref] = a;
    }
  }
  return { byRef, nameByRef, scanned: rows.length };
}

/* Auto-create missing crm_products rows for SKUs found in orders but not yet in catalog. */
async function autoCreateMissingProducts(missingRefs, nameByRef) {
  if (!missingRefs.length) return 0;
  const rows = missingRefs.map((ref) => ({
    id: "ss_" + ref.replace(/[^a-z0-9]/gi, "_").toLowerCase(),
    status: "active",
    name: nameByRef[ref] || ref,
    emoji: "💊",
    price: 0,
    unit_cost: 0,
    stock: 0,
    category: "Mediaplus",
    color: "#5b50f0",
    tracking_code: ref,
    ss_available: true,
    landing_pages: [],
    best_creatives: [],
    avatars: [],
    metrics: {},
    created_at: new Date().toISOString(),
  }));
  const r = await fetch(`${SB}/rest/v1/crm_products?on_conflict=id`, {
    method: "POST",
    headers: sb({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(rows),
  });
  return r.ok ? rows.length : 0;
}

async function patchProductsMetrics(byRef) {
  /* Fetch existing CRM products + their metrics to detect lock flag */
  const r = await fetch(`${SB}/rest/v1/crm_products?select=id,tracking_code,metrics&deleted_at=is.null`, {
    headers: sb(),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Supabase HTTP ${r.status}`);
  const products = await r.json();
  const refToId = {};
  const lockedRefs = new Set();
  for (const p of products) {
    if (p.tracking_code) {
      refToId[p.tracking_code] = p.id;
      if (p.metrics?.locked === true) lockedRefs.add(p.tracking_code);
    }
  }
  let patched = 0;
  const skipped = [];
  const lockedSkipped = [];
  /* Mutating outer var across the iterations */
  for (const [ref, metrics] of Object.entries(byRef)) {
    const id = refToId[ref];
    if (!id) {
      skipped.push(ref);
      continue;
    }
    if (lockedRefs.has(ref)) {
      lockedSkipped.push(ref);
      continue;
    }
    const pr = await fetch(
      `${SB}/rest/v1/crm_products?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: sb({ Prefer: "return=minimal" }),
        body: JSON.stringify({ metrics }),
      }
    );
    if (pr.ok) patched++;
  }
  return { patched, skipped, lockedSkipped };
}

export async function GET() {
  if (!SB || !KEY) {
    return Response.json({ success: false, error: "Supabase env vars not configured" }, { status: 500 });
  }
  try {
    const { byRef, scanned } = await aggregate();
    const sorted = Object.entries(byRef)
      .map(([ref, m]) => ({ ref, ...m }))
      .sort((a, b) => b.revenue - a.revenue);
    return Response.json({ success: true, scanned, productsCount: sorted.length, sorted });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500 });
  }
}



export async function POST() {
  if (!SB || !KEY) {
    return Response.json({ success: false, error: "Supabase env vars not configured" }, { status: 500 });
  }
  try {
    const { byRef, nameByRef, scanned } = await aggregate();
    /* First pass: patch existing */
    const firstPass = await patchProductsMetrics(byRef);
    /* Auto-create products for SKUs that don't exist yet */
    const autoCreated = await autoCreateMissingProducts(firstPass.skipped, nameByRef || {});
    /* Second pass: patch the newly-created products */
    let secondPass = { patched: 0 };
    if (autoCreated > 0) {
      secondPass = await patchProductsMetrics(byRef);
    }
    return Response.json({
      success: true,
      ordersScanned: scanned,
      uniqueSkus: Object.keys(byRef).length,
      productsPatched: firstPass.patched + secondPass.patched,
      autoCreated,
      lockedSkipped: firstPass.lockedSkipped,
      skuNotInCrm: [],
    });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500 });
  }
}
