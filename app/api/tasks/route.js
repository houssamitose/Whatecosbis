/* /api/tasks
   GET    → list non-deleted tasks
   POST   → create or upsert
   PATCH  → partial update
   DELETE → soft delete (?id=...) or hard delete (?id=...&hard=1)
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
function need() {
  if (!SB || !KEY) {
    return Response.json(
      { success: false, error: "Supabase env vars not configured" },
      { status: 500 }
    );
  }
  return null;
}

/* Map legacy/loose priority values to our schema's CHECK-constraint values */
function normPriority(p) {
  if (!p) return "normal";
  const s = String(p).toLowerCase();
  if (s === "medium" || s === "med") return "normal";
  if (["low", "normal", "high", "urgent"].includes(s)) return s;
  return "normal";
}
function normStatus(s) {
  if (!s) return "todo";
  const v = String(s).toLowerCase();
  if (["todo", "doing", "done", "blocked"].includes(v)) return v;
  if (v === "in_progress" || v === "inprogress") return "doing";
  if (v === "complete" || v === "completed") return "done";
  return "todo";
}

function toRow(t) {
  /* Only set product_id if it looks like a real product reference (text starting with 'p' or 'ss_') */
  const pidRaw = t.product_id || t.productId;
  const pid = pidRaw && /^(p|ss_)/.test(String(pidRaw)) ? pidRaw : null;
  return {
    id: t.id,
    title: t.title,
    description: t.description || t.desc || null,
    status: normStatus(t.status),
    priority: normPriority(t.priority),
    due_date: t.due_date || t.dueDate || t.date || null,
    /* assigned_to must be a UUID (auth.users.id). If it's a name like 'Houssam', drop it. */
    assigned_to: t.assigned_to && /^[0-9a-f-]{36}$/i.test(t.assigned_to) ? t.assigned_to : null,
    product_id: pid,
    /* Encode the responsible-person name in tags as 'resp:Name' so it survives the round-trip */
    tags: (() => {
      const base = Array.isArray(t.tags) ? t.tags.filter(x => typeof x === 'string' && !x.startsWith('resp:')) : [];
      const resp = t.resp || t.assignee_name;
      if (resp) base.push('resp:' + resp);
      return base.length ? base : null;
    })(),
    created_at: t.created_at || new Date().toISOString(),
    deleted_at: t.deleted_at || null,
  };
}

function fromRow(r) {
  /* Extract resp:Name back out of tags so the dashboard keeps showing the name */
  const tags = Array.isArray(r.tags) ? r.tags : [];
  const respTag = tags.find(t => typeof t === 'string' && t.startsWith('resp:'));
  const resp = respTag ? respTag.slice(5) : null;
  const cleanTags = tags.filter(t => !(typeof t === 'string' && t.startsWith('resp:')));
  return {
    id: r.id,
    title: r.title,
    description: r.description || "",
    desc: r.description || "",
    status: r.status,
    priority: r.priority,
    due_date: r.due_date,
    dueDate: r.due_date,
    date: r.due_date,
    assigned_to: r.assigned_to,
    assignedTo: r.assigned_to,
    resp: resp || "",
    product_id: r.product_id,
    productId: r.product_id,
    tags: cleanTags,
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
    const status = u.searchParams.get("status");
    const includeDeleted = u.searchParams.get("includeDeleted") === "1";
    const p = new URLSearchParams();
    p.set("select", "*");
    p.set("order", "created_at.desc");
    if (!includeDeleted) p.set("deleted_at", "is.null");
    if (status) p.set("status", `eq.${status}`);
    const r = await fetch(`${SB}/rest/v1/crm_tasks?${p}`, {
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
    return Response.json({ success: true, count: rows.length, tasks: rows.map(fromRow) });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500 });
  }
}

export async function POST(req) {
  const g = need();
  if (g) return g;
  try {
    const body = await req.json();
    const items = Array.isArray(body) ? body : body.items ? body.items : [body];
    const rows = items.map(toRow);
    const r = await fetch(`${SB}/rest/v1/crm_tasks?on_conflict=id`, {
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
    return Response.json({ success: true, count: out.length, tasks: out.map(fromRow) });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500 });
  }
}

export async function PATCH(req) {
  const g = need();
  if (g) return g;
  try {
    const body = await req.json();
    const id = body.id;
    const patch = body.patch || body;
    if (!id) {
      return Response.json({ success: false, error: "Missing id" }, { status: 400 });
    }
    const allowed = [
      "title",
      "description",
      "status",
      "priority",
      "due_date",
      "assigned_to",
      "product_id",
      "tags",
      "deleted_at",
    ];
    const clean = {};
    for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
    if (patch.dueDate !== undefined) clean.due_date = patch.dueDate;
    if (patch.assignedTo !== undefined) clean.assigned_to = patch.assignedTo;
    if (patch.productId !== undefined) clean.product_id = patch.productId;
    if (!Object.keys(clean).length) {
      return Response.json({ success: false, error: "Nothing to patch" }, { status: 400 });
    }
    const r = await fetch(
      `${SB}/rest/v1/crm_tasks?id=eq.${encodeURIComponent(id)}`,
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
    return Response.json({ success: true, task: out[0] ? fromRow(out[0]) : null });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500 });
  }
}

export async function DELETE(req) {
  const g = need();
  if (g) return g;
  try {
    const u = new URL(req.url);
    const id = u.searchParams.get("id");
    const hard = u.searchParams.get("hard") === "1";
    if (!id) {
      return Response.json({ success: false, error: "Missing id" }, { status: 400 });
    }
    if (hard) {
      const r = await fetch(
        `${SB}/rest/v1/crm_tasks?id=eq.${encodeURIComponent(id)}`,
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
    const r = await fetch(
      `${SB}/rest/v1/crm_tasks?id=eq.${encodeURIComponent(id)}`,
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
