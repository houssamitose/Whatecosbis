/* GET /api/config
   Returns the public-safe Supabase credentials so the browser can initialize
   Supabase Auth without the user having to manually enter URL + anon key.

   The ANON key is safe to expose — it's protected by Row Level Security
   policies. The SERVICE_ROLE key is NEVER returned by this endpoint.

   Env vars used:
     - SUPABASE_URL                 (already set)
     - SUPABASE_ANON_KEY            (needs to be added to Vercel env)
     - NEXT_PUBLIC_SUPABASE_ANON_KEY (alternative name)
*/

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET() {
  const url = process.env.SUPABASE_URL || "";
  const anonKey =
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return Response.json(
    {
      supabase: {
        url,
        anonKey,
        configured: !!(url && anonKey),
      },
    },
    { headers: CORS }
  );
}
