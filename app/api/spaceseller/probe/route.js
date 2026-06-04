export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SS_HOST = "https://drop.spaceseller.ma";
const DEFAULT_TOKEN = process.env.SPACESELLER_TOKEN || "4|bEzb0wCfIglCCXPHjyoTXCcTPy97Kvo2pHPe7KaU468ea2ce";
function getToken(req) {
    const auth = req.headers.get("authorization") || "";
    if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
    try { const u = new URL(req.url); const q = u.searchParams.get("token"); if (q) return q.trim(); } catch {}
    return DEFAULT_TOKEN;
  }
export async function GET(req) {
    try {
          const token = getToken(req);
          const u = new URL(req.url);
          const path = u.searchParams.get("path") || "/api/v1/orders";
          const full = SS_HOST + (path.startsWith("/") ? path : "/" + path);
          const r = await fetch(full, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
          const text = await r.text();
          return Response.json({ probed: full, status: r.status, ok: r.ok, ctype: r.headers.get("content-type"), body_preview: text.slice(0, 800) });
        } catch (err) {
          return Response.json({ error: err.message || String(err) }, { status: 502 });
        }
  }
