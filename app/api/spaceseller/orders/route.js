export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SS_BASE = "https://drop.spaceseller.ma/api/v1";
const DEFAULT_TOKEN = process.env.SPACESELLER_TOKEN || "4|bEzb0wCfIglCCXPHjyoTXCcTPy97Kvo2pHPe7KaU468ea2ce";
const CONCURRENCY = 6;
function getToken(req) {
     const auth = req.headers.get("authorization") || "";
     if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
     try { const u = new URL(req.url); const q = u.searchParams.get("token"); if (q) return q.trim(); } catch {}
     return DEFAULT_TOKEN;
}
async function fetchOne(id, token) {
     try {
            const r = await fetch(`${SS_BASE}/orders/${encodeURIComponent(id)}`, {
                     headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
                     cache: "no-store",
            });
            const text = await r.text();
            let parsed; try { parsed = JSON.parse(text); } catch { parsed = null; }
            if (r.ok && parsed?.success && parsed.data) return { ok: true, id, order: parsed.data };
            return { ok: false, id, status: r.status, error: parsed?.error || parsed?.message || `HTTP ${r.status}` };
     } catch (err) { return { ok: false, id, error: err.message || String(err) }; }
}
async function batchFetch(ids, token) {
     const results = [];
     for (let i = 0; i < ids.length; i += CONCURRENCY) {
            const slice = ids.slice(i, i + CONCURRENCY);
            const batch = await Promise.all(slice.map((id) => fetchOne(id, token)));
            results.push(...batch);
     }
     return results;
}
export async function GET(req) {
     try {
            const token = getToken(req);
            const u = new URL(req.url);
            const idsParam = u.searchParams.get("ids") || "";
            const ids = idsParam.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
            if (!ids.length) {
                     return Response.json({ success: true, count: 0, orders: [], errors: [], message: "Pass ?ids=123,456 — no list endpoint" });
            }
            const results = await batchFetch(ids, token);
            const orders = results.filter(r => r.ok).map(r => r.order);
            const errors = results.filter(r => !r.ok).map(({id,status,error}) => ({id,status,error}));
            return Response.json({ success: true, requested: ids.length, count: orders.length, orders, errors });
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
            let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
            return Response.json({ success: r.ok, status: r.status, data: parsed }, { status: r.ok ? 200 : r.status });
     } catch (err) {
            return Response.json({ success: false, error: err.message || String(err) }, { status: 502 });
     }
}
        
