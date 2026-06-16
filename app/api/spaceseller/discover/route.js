/* GET /api/spaceseller/discover
   Discovery endpoint — tries various SpaceSeller URL/header combinations
   to find a listing endpoint that works with the API token (no session).
   Returns the status + first 500 chars of each response.
*/

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN = process.env.SPACESELLER_TOKEN || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

async function probe(label, url, headers = {}) {
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/json",
        "User-Agent": "EcomProBot/1.0",
        ...headers,
      },
      redirect: "manual",
      cache: "no-store",
    });
    const text = await r.text();
    return {
      label,
      url,
      status: r.status,
      contentType: r.headers.get("content-type"),
      location: r.headers.get("location"),
      isJson: r.headers.get("content-type")?.includes("json") || false,
      preview: text.slice(0, 300),
      length: text.length,
    };
  } catch (e) {
    return { label, url, error: e.message };
  }
}

export async function GET() {
  const tests = [];

  /* 1. Try various listing-style API paths */
  tests.push(await probe("v1-orders-list",        "https://drop.spaceseller.ma/api/v1/orders"));
  tests.push(await probe("v1-orders-paginated",   "https://drop.spaceseller.ma/api/v1/orders?page=1"));
  tests.push(await probe("v1-orders-since",       "https://drop.spaceseller.ma/api/v1/orders?since=2026-06-15"));
  tests.push(await probe("v1-orders-after",       "https://drop.spaceseller.ma/api/v1/orders?after=408288"));
  tests.push(await probe("v1-my-orders",          "https://drop.spaceseller.ma/api/v1/my-orders"));
  tests.push(await probe("v1-orders-limit",       "https://drop.spaceseller.ma/api/v1/orders?limit=10"));
  tests.push(await probe("v1-orders-recent",      "https://drop.spaceseller.ma/api/v1/orders/recent"));

  /* 2. Try the Inertia listing page with the token */
  tests.push(await probe("admin-orders-bearer",   "https://drop.spaceseller.ma/admin/orders", { "X-Inertia": "true" }));
  tests.push(await probe("admin-orders-json",     "https://drop.spaceseller.ma/admin/orders.json"));

  /* 3. Statuses endpoint as a known-working sanity check */
  tests.push(await probe("v1-statuses",           "https://drop.spaceseller.ma/api/v1/statuses"));

  return Response.json({ success: true, tokenPrefix: TOKEN.slice(0, 8) + "...", tests }, { headers: CORS });
}
