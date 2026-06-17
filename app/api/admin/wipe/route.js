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

export async function POST(req) {
  if (!SB || !KEY) {
    return Response.json({ success: false, error: "Env vars missing" }, { status: 500 });
  }
  const u = new URL(req.url);
  if (u.searchParams.get("confirm") !== "YES_REALLY_WIPE") {
    return Response.json({ success: false, error: "Add ?confirm=YES_REALLY_WIPE to actually run" }, { status: 400 });
  }
  try {
    /* Order matters: lead_imports references nothing, ss_orders + ss_tracked_ids are independent, products independent. */
    const results = [];
    for (const t of ["crm_lead_imports", "ss_orders", "ss_tracked_ids", "crm_products"]) {
      results.push(await wipeTable(t));
    }
    return Response.json({ success: true, results });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500 });
  }
}
