/* GET /api/leads/sheets-poll
   POST same — reads a public Google Sheet (CSV export), finds new rows not
   yet in crm_lead_imports, sends each to SpaceSeller via POST /api/v1/orders.

   Setup: the Google Sheet must be shared as "Anyone with the link can view".
   Then export URL is:
     https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}

   Env vars:
     GOOGLE_SHEET_ID      — the spreadsheet's id (mandatory)
     GOOGLE_SHEET_GID     — the tab's gid (default '0')
     GOOGLE_SHEET_RANGE   — ignored when using CSV export (kept for future API mode)

   Expected columns (tab-separated or comma-separated CSV):
     date_order | fullname | phone | address | product_ref | qte | price
   Header row is auto-detected if first row contains words "date", "name", etc.

   Designed for Vercel cron — minimum interval depends on plan.
*/

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

function parseCsv(text) {
  /* Robust enough for typical Google Sheets export */
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (cell !== "" || row.length) row.push(cell);
        if (row.length) rows.push(row);
        row = []; cell = "";
        if (c === "\r" && text[i + 1] === "\n") i++;
      } else cell += c;
    }
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function detectHeader(row) {
  const lc = row.map((c) => (c || "").toLowerCase().trim());
  return lc.some((c) => /date|name|phone|fullname|product/.test(c));
}

function mapRow(row, headerMap) {
  if (headerMap) {
    return {
      date_order: row[headerMap.date_order] || "",
      fullname:   row[headerMap.fullname]   || "",
      phone:      row[headerMap.phone]      || "",
      address:    row[headerMap.address]    || "",
      product_ref:row[headerMap.product_ref]|| "",
      qte:        row[headerMap.qte]        || 1,
      price:      row[headerMap.price]      || 0,
    };
  }
  /* Positional mapping when no header */
  return {
    date_order: row[0] || "",
    fullname:   row[1] || "",
    phone:      row[2] || "",
    address:    row[3] || "",
    product_ref:row[4] || "",
    qte:        row[5] || 1,
    price:      row[6] || 0,
  };
}

function buildHeaderMap(header) {
  const find = (regex) => header.findIndex((c) => regex.test((c || "").toLowerCase()));
  return {
    date_order:  find(/date|time|created/),
    fullname:    find(/name|fullname|client/),
    phone:       find(/phone|tel|num/),
    address:     find(/address|adresse/),
    product_ref: find(/sku|ref|product|produit/),
    qte:         find(/qte|qty|quantity|qu/),
    price:       find(/price|prix|amount|montant/),
  };
}

async function readSheet(sheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Sheet fetch HTTP ${r.status}`);
  const text = await r.text();
  return parseCsv(text);
}

async function handle(req) {
  const url = new URL(req.url);
  const sheetId = url.searchParams.get('sheetId') || process.env.GOOGLE_SHEET_ID;
  const gid = url.searchParams.get('gid') || process.env.GOOGLE_SHEET_GID || "0";
  if (!sheetId) {
    return Response.json({ success: false, error: "GOOGLE_SHEET_ID env var missing" }, { status: 500, headers: CORS });
  }
  try {
    const rows = await readSheet(sheetId, gid);
    if (!rows.length) {
      return Response.json({ success: true, message: "Empty sheet", processed: 0 }, { headers: CORS });
    }
    let dataRows = rows;
    let headerMap = null;
    if (detectHeader(rows[0])) {
      headerMap = buildHeaderMap(rows[0]);
      dataRows = rows.slice(1);
    }
    const leads = dataRows
      .filter((r) => r.length >= 5 && (r[1] || "").trim()) /* must have at least name */
      .map((r, idx) => ({
        ...mapRow(r, headerMap),
        source: "gsheet",
        source_ref: `${sheetId}#row${idx + (headerMap ? 2 : 1)}`,
        raw: r,
      }));
    if (!leads.length) {
      return Response.json({ success: true, message: "No valid rows", processed: 0, totalRows: rows.length }, { headers: CORS });
    }
    /* Delegate to send-to-spaceseller endpoint */
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const host = req.headers.get("host");
    const sendR = await fetch(`${proto}://${host}/api/leads/send-to-spaceseller`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: leads }),
    });
    const sendJ = await sendR.json();
    return Response.json({
      success: true,
      sheetRows: rows.length,
      validLeads: leads.length,
      ...sendJ,
    }, { headers: CORS });
  } catch (e) {
    return Response.json({ success: false, error: e.message || String(e) 