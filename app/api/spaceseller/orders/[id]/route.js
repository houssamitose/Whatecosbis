/* GET /api/spaceseller/orders/:id -- fetch a single order's full detail
   Proxied server-side to bypass CORS. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SS_BASE = "https://drop.spaceseller.ma/api/v1";
const DEFAULT_TOKEN =
  process.env.SPACESELLER_TOKEN ||
  "4|bEzb0wCfIglCCXPHjyoTXCcTPy97Kvo2pHPe7KaU468ea2ce";

function getToken(req) {
  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  try {
    const u = new URL(req.url);
    const q = u.searchParams.get("token");
    if (q) return q.trim();
  } catch {}
  return DEFAULT_TOKEN;
}

export async function GET(req, { params }) {
  try {
    const token = getToken(req);
    const id = params?.id;
    if (!id) {
      return Response.json({ success: false, error: "missing order id" }, { status: 400 });
    }
    const r = await fetch(`${SS_BASE}/orders/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    const text = await r.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    return Response.json(parsed, { status: r.ok ? 200 : r.status });
  } catch (err) {
    return Response.json({ success: false, error: err.message || String(err) }, { status: 502 });
  }
}
