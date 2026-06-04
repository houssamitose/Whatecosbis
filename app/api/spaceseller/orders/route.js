/* GET  /api/spaceseller/orders?page=1&per_page=100   -- single page
   GET  /api/spaceseller/orders?all=1                  -- fetches every page server-side
   POST /api/spaceseller/orders                        -- create order (body forwarded)
   Auth: Authorization: Bearer <token>  OR  ?token=<token>  (server-side only)
   Solves the CORS block that prevents calling drop.spaceseller.ma directly from the browser. */

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

async function ssFetch(path, token) {
    const r = await fetch(`${SS_BASE}${path}`, {
          headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: "application/json",
                },
          cache: "no-store",
        });
    const text = await r.text();
    if (!r.ok) {
          throw new Error(`SpaceSeller HTTP ${r.status}: ${text.slice(0, 200)}`);
        }
    try {
          return JSON.parse(text);
        } catch {
          throw new Error(`SpaceSeller returned non-JSON: ${text.slice(0, 200)}`);
        }
  }

export async function GET(req) {
    try {
          const token = getToken(req);
          const u = new URL(req.url);
          const fetchAll = u.searchParams.get("all") === "1";

          if (fetchAll) {
                  let all = [];
                  let page = 1;
                  let lastPage = 1;
                  const maxPages = 100;
                  while (page <= lastPage && page <= maxPages) {
                            const json = await ssFetch(`/orders?page=${page}&per_page=100`, token);
                            const items = Array.isArray(json?.data?.data)
                              ? json.data.data
                              : Array.isArray(json?.data)
                              ? json.data
                              : [];
                            all = all.concat(items);
                            lastPage = json?.data?.last_page || 1;
                            if (items.length === 0) break;
                            page++;
                          }
                  return Response.json({ success: true, count: all.length, pages_fetched: page - 1, orders: all });
                }

          const page = u.searchParams.get("page") || "1";
          const per = u.searchParams.get("per_page") || "100";
          const json = await ssFetch(`/orders?page=${page}&per_page=${per}`, token);
          return Response.json({ success: true, ...json });
        } catch (err) {
          return Response.json({ success: false, error: err.message || String(err) }, { status: 502 });
        }
  }

export async function POST(req) {
    try {
          const token = getToken(req);
          const body = await req.json();
          const r = await fetch(`${SS_BASE}/orders`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                });
          const text = await r.text();
          let parsed;
          try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
          return Response.json({ success: r.ok, status: r.status, data: parsed }, { status: r.ok ? 200 : r.status });
        } catch (err) {
          return Response.json({ success: false, error: err.message || String(err) }, { status: 502 });
        }
  }
