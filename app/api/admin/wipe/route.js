/* POST /api/admin/wipe?confirm=YES_REALLY_WIPE
   Deletes all rows from:
   - crm_lead_imports
   - ss_orders
   - ss_tracked_ids
   - crm_products

   This is a one-shot "fresh start" tool. Requires explicit confirm param.
   Returns counts of rows deleted per table.
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

async function wipeTable(table) {
  /* PostgREST requires a filter even for delete-all. Use a permissive filter on the primary key. */
  const url = `${SB}/rest/v1/${table}?id=not.is.null`;
  const r = await fetch(url, {
    method: "DELETE",
    headers: sb({ Prefer: "return=representation" }),
  });
  if (!r.ok) {
    const t = await r.text();
    /* fallback for tables that use order_id PK */
    if (table === "ss_orders" || table === "ss_tracked_ids") {
      const url2 = `${SB}/rest/v1/${table}?order_id=not.is.null`;
      const r2 = await fetch(url2, {
        method: "DELETE",
        headers: sb({ Prefer: "return=representation" }),
      });
      if (!r2.ok) {
        const tt = await r2.text();
        return { table, error: `HTTP ${r2.status}: ${tt.slice(0, 200)}` };
      }
      const rows = await r2.json();
      return { table, deleted: rows.length };
    }
    return { table, error: `HTTP ${r.status}: ${t.slice(0, 200)}` };
  }
  const rows = await r.json();
  return { table, deleted: rows.length };
}

async function deleteOrder(orderId) {
  const h = sb({ Prefer: "return=representation" });
  const [r1, r2, r3] = await Promise.all([
    fetch(`${SB}/rest/v1/ss_orders?order_id=eq.${orderId}`, { method: "DELETE", headers: h }),
    fetch(`${SB}/rest/v1/ss_tracked_ids?order_id=eq.${orderId}`, { method: "DELETE", headers: h }),
    fetch(`${SB}/rest/v1/crm_lead_imports?spaceseller_order_id=eq.${orderId}`, { method: "DELETE", headers: h }),
  ]);
  return {
    ss_orders: r1.ok ? (await r1.json()).length : `err ${r1.status}`,
    ss_tracked_ids: r2.ok ? (await r2.json()).length : `err ${r2.status}`,
    crm_lead_imports: r3.ok ? (await r3.json()).length : `err ${r3.status}`,
  };
}

export async function POST(req) {
  if (!SB || !KEY) {
    return Response.json({ success: false, error: "Env vars missing" }, { status: 500 });
  }
  const u = new URL(req.url);

  /* Targeted single-order delete: ?order_id=XXX */
  const orderId = parseInt(u.searchParams.get("order_id"), 10);
  if (Number.isFinite(orderId)) {
    try {
      const result = await deleteOrder(orderId);
      return Response.json({ success: true, deleted_order: orderId, result });
    } catch (e) {
      return Response.json({ success: false, error: e.message || String(e) }, { status: 500 });
    }
  }

  if (u.searchParams.get("confirm") !== "YES_REALLY_WIPE") {
    return Response.json({ success: false, error: "Add ?confirm=YES_REALLY_WIPE to actually run" }, { status: 400 });
  }
  try {
    const results = [];
    for (const t of ["crm_lead_imports", "ss_orders", "ss_tracked_ids", "crm_products"]) {
      results.push(await wipeTable(t));
    }
    return Response.json({ success: true, results });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500 });
  }
}

export const DELETE = POST;
