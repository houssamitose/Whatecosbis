/* /api/products
   GET    → list non-deleted products
   POST   → create / upsert (body = product object or { items: [...] } for bulk)
   PATCH  → partial update (body = { id, patch: {...} })
   DELETE → soft delete (?id=...)  or hard delete (?id=...&hard=1)

   All routes use SUPABASE_SERVICE_ROLE_KEY server-side and bypass RLS. The
   client never sees the service-role key. Once Supabase Auth is in place
   we'll validate the user's JWT here before mutating.
*/

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sb(headers = {}) {
  return {
    apikey: KEY || "",
    Authorization: `Bearer ${KEY || ""}`,
    "Content-Type": "application/json",
    ...headers,
  };
}

function need() {
  if (!SB || !KEY) {
    return Response.json(
      { success: false, error: "Supabase env vars not configured" },
      { status: 500 }
    );
  }
  return null;
}

/* Convert client-side camelCase product → snake_case DB row */
function toRow(p) {
  return {
    id: p.id,
    status: p.status || "active",
    name: p.name,
    emoji: p.emoji || "📦",
    price: typeof p.price === "number" ? p.price : parseFloat(p.price) || 0,
    unit_cost: typeof p.unit_cost === "number" ? p.unit_cost : parseFloat(p.unit_cost ?? p.unitCost) || 0,
    stock: parseInt(p.stock ?? 0, 10) || 0,
    category: p.category || null,
    color: p.color || null,
    tracking_code: p.tracking_code || p.trackingCode || null,
    ss_available: !!(p.ss_available || p.ssAvailable),
    landing_page: p.landing_page || p.landingPage || null,
    landing_pages: p.landing_pages || p.landingPages || [],
    best_creatives: p.best_creatives || p.bestCreatives || [],
    avatars: p.avatars || [],
    metrics: p.metrics || {},
    created_at: p.created_at || new Date().toISOString(),
    deleted_at: p.deleted_at || null,
  };
}

/* Convert snake_case DB row → client-side product (keep both camel + snake for back-compat) */
function fromRow(r) {
  return {
    id: r.id,
    status: r.status,
    name: r.name,
    emoji: r.emoji,
    price: Number(r.price) || 0,
    unit_cost: Number(r.unit_cost) || 0,
    unitCost: Number(r.unit_cost) || 0,
    stock: Number(r.stock) || 0,
    category: r.category || "–",
    color: r.color || "linear-gradient(135deg,#5b50f0,#9b8fff)",
    tracking_code: r.tracking_code || "",
    trackingCode: r.tracking_code || "",
    ss_available: !!r.ss_available,
    ssAvailable: !!r.ss_available,
    landing_page: r.landing_page || "",
    landingPage: r.landing_page || "",
    landingPages: r.landing_pages || [],
    bestCreatives: r.best_creatives || [],
    avatars: r.avatars || [],
    metrics: r.metrics || {},
    created_at: r.created_at,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    updated_at: r.updated_at,
    deleted_at: r.deleted_at,
  };
}

/* ============================================================================ */
export async function GET(req) {
  const guard = need();
  if (guard) return guard;
  try {
    const u = new URL(req.url);
    const status = u.searchParams.get("status");
    const includeDeleted = u.searchParams.get("includeDeleted") === "1";

    const params = new URLSearchParams();
    params.set("select", "*");
    params.set("order", "created_at.desc");
    if (!includeDeleted) params.set("deleted_at", "is.null");
    if (status) params.set("status", `eq.${status}`);

    const r = await fetch(`${SB}/rest/v1/crm_products?${params.toString()}`, {
      headers: sb(),
      cache: "no-store",
    });
    if (!r.ok) {
      const t = await r.text();
      return Response.json(
        { success: false, error: `Supabase HTTP ${r.status}`, body: t.slice(0, 300) },
        { status: r.status }
      );
    }
    const rows = await r.json();
    return Response.json({
      success: true,
      count: rows.length,
      products: rows.map(fromRow),
    });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500 });
  }
}

/* ============================================================================ */
export async function POST(req) {
  const guard = need();
  if (guard) return guard;
  try {
    const body = await req.json();
    const items = Array.isArray(body) ? body : body.items ? body.items : [body];
    if (!items.length) {
      return Response.json({ success: false, error: "No items" }, { status: 400 });
    }
    const rows = items.map(toRow);

    /* PostgREST upsert via Prefer: resolution=merge-duplicates */
    const r = await fetch(`${SB}/rest/v1/crm_products?on_conflict=id`, {
      method: "POST",
      headers: sb({ Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify(rows),
    });
    if (!r.ok) {
      const t = await r.text();
      return Response.json(
        { success: false, error: `Supabase HTTP ${r.status}`, body: t.slice(0, 300) },
        { status: r.status }
      );
    }
    const out = await r.json();
    return Response.json({
      success: true,
      count: out.length,
      products: out.map(fromRow),
    });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500 });
  }
}

/* ============================================================================ */
export async function PATCH(req) {
  const guard = need();
  if (guard) return guard;
  try {
    const body = await req.json();
    const id = body.id;
    const patch = body.patch || body;
    if (!id) {
      return Response.json({ success: false, error: "Missing id" }, { status: 400 });
    }
    /* Allow only known columns through */
    const allowed = [
      "status",
      "name",
      "emoji",
      "price",
      "unit_cost",
      "stock",
      "category",
      "color",
      "tracking_code",
      "ss_available",
      "landing_page",
      "landing_pages",
      "best_creatives",
      "avatars",
      "metrics",
      "deleted_at",
    ];
    const clean = {};
    for (const k of allowed) {
      if (patch[k] !== undefined) clean[k] = patch[k];
    }
    /* also accept camelCase from client */
    if (patch.unitCost !== undefined) clean.unit_cost = patch.unitCost;
    if (patch.trackingCode !== undefined) clean.tracking_code = patch.trackingCode;
    if (patch.ssAvailable !== undefined) clean.ss_available = patch.ssAvailable;
    if (patch.landingPage !== undefined) clean.landing_page = patch.landingPage;
    if (patch.landingPages !== undefined) clean.landing_pages = patch.landingPages;
    if (patch.bestCreatives !== undefined) clean.best_creatives = patch.bestCreatives;

    if (!Object.keys(clean).length) {
      return Response.json({ success: false, error: "Nothing to patch" }, { status: 400 });
    }
    const r = await fetch(
      `${SB}/rest/v1/crm_products?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: sb({ Prefer: "return=representation" }),
        body: JSON.stringify(clean),
      }
    );
    if (!r.ok) {
      const t = await r.text();
      return Response.json(
        { success: false, error: `Supabase HTTP ${r.status}`, body: t.slice(0, 300) },
        { status: r.status }
      );
    }
    const out = await r.json();
    return Response.json({
      success: true,
      product: out[0] ? fromRow(out[0]) : null,
    });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500 });
  }
}

/* ============================================================================ */
export async function DELETE(req) {
  const guard = need();
  if (guard) return guard;
  try {
    const u = new URL(req.url);
    const id = u.searchParams.get("id");
    const hard = u.searchParams.get("hard") === "1";
    if (!id) {
      return Response.json({ success: false, error: "Missing id" }, { status: 400 });
    }
    if (hard) {
      const r = await fetch(
        `${SB}/rest/v1/crm_products?id=eq.${encodeURIComponent(id)}`,
        { method: "DELETE", headers: sb() }
      );
      if (!r.ok) {
        const t = await r.text();
        return Response.json(
          { success: false, error: `Supabase HTTP ${r.status}`, body: t.slice(0, 300) },
          { status: r.status }
        );
      }
      return Response.json({ success: true, deleted: id, hard: true });
    }
    /* soft delete */
    const r = await fetch(
      `${SB}/rest/v1/crm_products?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: sb({ Prefer: "return=representation" }),
        body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      }
    );
    if (!r.ok) {
      const t = await r.text();
      return Response.json(
        { success: false, error: `Supabase HTTP ${r.status}`, body: t.slice(0, 300) },
        { status: r.status }
      );
    }
    return Response.json({ success: true, deleted: id, hard: false });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500 });
  }
}
