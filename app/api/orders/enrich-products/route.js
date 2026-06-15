/* POST /api/orders/enrich-products
   Body: { items: [{ order_id: 408288, products: [{ ref, name, price, qte }, ...] }, ...] }
   Patches the `products` jsonb column on ss_orders for each provided order_id.

   Used to backfill product info that the SpaceSeller GET /orders/{id} API doesn't
   return — we scrape it from the listing pages and call this endpoint to enrich
   existing rows.
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

export async function POST(req) {
  if (!SB || !KEY) {
    return Response.json({ success: false, error: "Supabase env vars not configured" }, { status: 500 });
  }
  try {
    const body = await req.json();
    const items = Array.isArray(body) ? body : body.items;
    if (!Array.isArray(items) || !items.length) {
      return Response.json({ success: false, error: "items array required" }, { status: 400 });
    }

    let patched = 0;
    const errors = [];

    for (const it of items) {
      const orderId = it.order_id;
      const products = it.products;
      if (!orderId || !Array.isArray(products)) {
        errors.push({ order_id: orderId, error: "invalid item" });
        continue;
      }
      const r = await fetch(
        `${SB}/rest/v1/ss_orders?order_id=eq.${encodeURIComponent(orderId)}`,
        {
          method: "PATCH",
          headers: sb({ Prefer: "return=minimal" }),
          body: JSON.stringify({ products }),
        }
      );
      if (r.ok) {
        patched++;
      } else {
        const t = await r.text().catch(() => "");
        errors.push({ order_id: orderId, status: r.status, body: t.slice(0, 100) });
      }
    }

    return Response.json({
      success: true,
      received: items.length,
      patched,
      errorCount: errors.length,
      errors: errors.slice(0, 10),
    });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500 });
  }
}
