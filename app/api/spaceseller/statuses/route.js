/* GET /api/spaceseller/statuses
   Returns the dynamic list of order statuses + delivery statuses configured on
   the seller account. Proxied server-side to bypass CORS. */

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

async function safeFetch(path, token) {
    try {
          const r = await fetch(`${SS_BASE}${path}`, {
                  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
                  cache: "no-store",
                });
          if (!r.ok) return null;
          return await r.json();
        } catch {
          return null;
        }
  }

export async function GET(req) {
    const token = getToken(req);
    const [os, ds] = await Promise.all([
          safeFetch("/order-statuses", token),
          safeFetch("/delivery-statuses", token),
        ]);
    return Response.json({
          success: true,
          order_statuses: os?.data || os || [],
          delivery_statuses: ds?.data || ds || [],
        });
  }
