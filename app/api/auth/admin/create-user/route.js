/* POST /api/auth/admin/create-user
   Body: { email, password, name, role?, phone?, send_invite? }
   Creates a Supabase Auth user AND a crm_team_members row in one shot.

   Uses SUPABASE_SERVICE_ROLE_KEY server-side — the key never reaches the
   browser. The end-user (admin) types the new member's email+password in
   the CRM team form; that form posts here.

   The Supabase admin API:
     POST {SUPABASE_URL}/auth/v1/admin/users
     headers: apikey + Authorization: Bearer {service_role_key}
     body: { email, password, email_confirm:true, user_metadata:{name, role} }
*/

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
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

export async function POST(req) {
  if (!SB || !KEY) {
    return Response.json({ success: false, error: "Supabase env vars not configured" }, { status: 500, headers: CORS });
  }
  try {
    const body = await req.json();
    const email = (body.email || "").trim().toLowerCase();
    const password = (body.password || "").trim();
    const name = (body.name || "").trim() || email.split("@")[0];
    const role = normRole(body.role);
    const phone = body.phone || null;

    if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
      return Response.json({ success: false, error: "Email invalide" }, { status: 400, headers: CORS });
    }
    if (!password || password.length < 6) {
      return Response.json({ success: false, error: "Mot de passe : 6 caractères minimum" }, { status: 400, headers: CORS });
    }

    /* Step 1: create the Supabase Auth user */
    const authR = await fetch(`${SB}/auth/v1/admin/users`, {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, role, phone },
      }),
    });
    if (!authR.ok) {
      const t = await authR.text();
      /* Common error: user already exists */
      const friendly = /already.*registered|already.*exists|duplicate/i.test(t)
        ? "Un compte existe déjà avec cet email"
        : `Auth create failed (${authR.status}): ${t.slice(0, 200)}`;
      return Response.json({ success: false, error: friendly }, { status: authR.status, headers: CORS });
    }
    const authUser = await authR.json();
    const authUserId = authUser.id;

    /* Step 2: insert/upsert the crm_team_members row, linked to the auth user */
    const tmId = "tm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const teamR = await fetch(`${SB}/rest/v1/crm_team_members?on_conflict=id`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify([{
        id: tmId,
        name,
        email,
        role,
        phone,
        auth_user_id: authUserId,
        active: true,
        created_at: new Date().toISOString(),
      }]),
    });

    const teamRow = teamR.ok ? (await teamR.json())[0] : null;

    return Response.json({
      success: true,
      auth_user_id: authUserId,
      member: teamRow ? {
        id: teamRow.id,
        name: teamRow.name,
        email: teamRow.email,
        role: teamRow.role,
        auth_user_id: teamRow.auth_user_id,
      } : null,
    }, { headers: CORS });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) }, { status: 500, headers: CORS });
  }
}
