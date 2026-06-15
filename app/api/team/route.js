/* /api/team
   GET    → all team members (non-deleted)
   POST   → upsert one or many ({ items: [...] } or single object)
   PATCH  → partial update { id, patch }
   DELETE → soft delete (?id=...)
*/

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

function sb(extra = {}) {
  return {
    apikey: KEY || "",
    Authorization: `Bearer ${KEY || ""}`,
    "Content-Type": "application/json",
    ...extra,
  };
}
function need() {
  if (!SB || !KEY) {
    return Response.json({ success: false, error: "Supabase env vars not configured" }, { status: 500, headers: CORS });
  }
  return null;
}

function normRole(r) {
  if (!r) return "member";
  const s = String(r).toLowerCase();
  const valid = ["admin","member","viewer","agent_confirm","agent_delivery","accountant"];
  if (valid.includes(s)) return s;
  if (s === "agent" || s === "agent confirmation") return "agent_confirm";
  if (s === "livraison" || s === "delivery") return "agent_delivery";
  if (s === "comptable") return "accountant";
  return "member";
}

function toRow(m) {
  return {
    id: m.id || ("tm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
    name: m.name || m.fullname || "",
    email: m.email || null,
    role: normRole(m.role),
    auth_user_id: m.auth_user_id && /^[0-9a-f-]{36}$/i.test(m.auth_user_id) ? m.auth_user_id : null,
    avatar_url: m.avatar_url || null,
    phone: m.phone || null,
    active: m.active !== false,
    created_at: m.created_at || new Date().toISOString(),
    deleted_at: m.deleted_at || null,
  };
}

function fromRow(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email || "",
    role: r.role,
    auth_user_id: r.auth_user_id,
    avatar_url: r.avatar_url || "",
    phone: r.phone || "",
    active: !!r.active,
    created_at: r.created_at,
    updated_at: r.updated_at,
    deleted_at: r.deleted_at,
  };
}

export async function GET(req) {
  const g = need();
  if (g) return g;
  try {
    const u = new URL(req.url);
    const includeDeleted = u.searchParams.get("includeDeleted") === "1";
    const p = new URLSearchParams();
    p.set("select", "*");
    p.set("order", "created_at.asc");
    if (!includeDeleted) p.set("deleted_at", "is.null");
    const r = await fetch(`${SB}/rest/v1/crm_team_members?${p}`, { headers: sb(), cache: "no-store" });
    if (!r.ok) {
      const t = await r.text();
      return Response.json({ success: false, error: `Supabase HTTP ${r.status}`, body: t.slice(0, 300) }, { status: r.status, headers: CORS });
    }
    const rows = await r.json();
    return Response.json({ success: true, count: rows.length, members: rows.map(fromRow) }, { headers: CORS });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500, headers: CORS });
  }
}

export async function POST(req) {
  const g = need();
  if (g) return g;
  try {
    const body = await req.json();
    const items = Array.isArray(body) ? body : body.items ? body.items : [body];
    const rows = items.map(toRow);
    const r = await fetch(`${SB}/rest/v1/crm_team_members?on_conflict=id`, {
      method: "POST",
      headers: sb({ Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify(rows),
    });
    if (!r.ok) {
      const t = await r.text();
      return Response.json({ success: false, error: `Supabase HTTP ${r.status}`, body: t.slice(0, 300) }, { status: r.status, headers: CORS });
    }
    const out = await r.json();
    return Response.json({ success: true, count: out.length, members: out.map(fromRow) }, { headers: CORS });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500, headers: CORS });
  }
}

export async function PATCH(req) {
  const g = need();
  if (g) return g;
  try {
    const body = await req.json();
    const id = body.id;
    const patch = body.patch || body;
    if (!id) return Response.json({ success: false, error: "Missing id" }, { status: 400, headers: CORS });
    const allowed = ["name", "email", "role", "auth_user_id", "avatar_url", "phone", "active", "deleted_at"];
    const clean = {};
    for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
    if (clean.role) clean.role = normRole(clean.role);
    if (!Object.keys(clean).length) return Response.json({ success: false, error: "Nothing to patch" }, { status: 400, headers: CORS });
    const r = await fetch(`${SB}/rest/v1/crm_team_members?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: sb({ Prefer: "return=representation" }),
      body: JSON.stringify(clean),
    });
    if (!r.ok) {
      const t = await r.text();
      return Response.json({ success: false, error: `Supabase HTTP ${r.status}`, body: t.slice(0, 300) }, { status: r.status, headers: CORS });
    }
    const out = await r.json();
    return Response.json({ success: true, member: out[0] ? fromRow(out[0]) : null }, { headers: CORS });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500, headers: CORS });
  }
}

export async function DELETE(req) {
  const g = need();
  if (g) return g;
  try {
    const u = new URL(req.url);
    const id = u.searchParams.get("id");
    if (!id) return Response.json({ success: false, error: "Missing id" }, { status: 400, headers: CORS });
    const r = await fetch(`${SB}/rest/v1/crm_team_members?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: sb({ Prefer: "return=minimal" }),
      body: JSON.stringify({ deleted_at: new Date().toISOString() }),
    });
    if (!r.ok) {
      const t = await r.text();
      return Response.json({ success: false, error: `Supabase HTTP ${r.status}`, body: t.slice(0, 300) }, { status: r.status, headers: CORS });
    }
    return Response.json({ success: true, deleted: id }, { headers: CORS });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500, headers: CORS });
  }
}
