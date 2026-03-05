// ─────────────────────────────────────────────────────────────────
//  Odoo MCP Server  —  Streamable HTTP Transport
//  MCP Spec: 2025-06-18  |  Authless  |  Odoo Community Edition
// ─────────────────────────────────────────────────────────────────

import express from "express";
import cors from "cors";
import xmlrpc from "xmlrpc";
import { config } from "dotenv";
import { randomUUID } from "crypto";

config();

const app = express();

// ── CORS — allow Claude.ai origin ────────────────────────────────
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "HEAD", "OPTIONS", "DELETE"],
  allowedHeaders: [
    "Content-Type", "Authorization", "Accept",
    "Mcp-Session-Id", "Last-Event-ID",
  ],
  exposedHeaders: ["Mcp-Session-Id"],
}));

app.use(express.json());

// ── Config ────────────────────────────────────────────────────────
const ODOO_URL  = process.env.ODOO_URL   || "http://localhost:8069";
const ODOO_DB   = process.env.ODOO_DB    || "odoo";
const ODOO_USER = process.env.ODOO_USER  || "admin";
const ODOO_PASS = process.env.ODOO_PASS  || "admin";
const PORT      = process.env.PORT       || 3000;

// ── Odoo XML-RPC ──────────────────────────────────────────────────
function getOdooClient(path) {
  const url = new URL(ODOO_URL);
  const options = {
    host: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path,
  };
  return url.protocol === "https:"
    ? xmlrpc.createSecureClient(options)
    : xmlrpc.createClient(options);
}

async function authenticate() {
  return new Promise((resolve, reject) => {
    const client = getOdooClient("/xmlrpc/2/common");
    client.methodCall("authenticate", [ODOO_DB, ODOO_USER, ODOO_PASS, {}], (err, uid) => {
      if (err) return reject(err);
      if (!uid) return reject(new Error("Odoo auth failed — check ODOO_USER / ODOO_PASS"));
      resolve(uid);
    });
  });
}

async function callOdoo(model, method, args, kwargs = {}) {
  const uid = await authenticate();
  return new Promise((resolve, reject) => {
    const client = getOdooClient("/xmlrpc/2/object");
    client.methodCall(
      "execute_kw",
      [ODOO_DB, uid, ODOO_PASS, model, method, args, kwargs],
      (err, value) => { if (err) reject(err); else resolve(value); }
    );
  });
}

// ── Tool Definitions ──────────────────────────────────────────────
const TOOLS = [
  {
    name: "search_partners",
    description: "Search for customers, suppliers, or contacts in Odoo",
    inputSchema: {
      type: "object",
      properties: {
        name:        { type: "string",  description: "Filter by name (partial match)" },
        is_customer: { type: "boolean", description: "Filter only customers" },
        is_supplier: { type: "boolean", description: "Filter only suppliers" },
        limit:       { type: "number",  description: "Max results (default 10)" },
      },
    },
  },
  {
    name: "create_partner",
    description: "Create a new customer or supplier contact in Odoo",
    inputSchema: {
      type: "object",
      properties: {
        name:          { type: "string",  description: "Full name" },
        email:         { type: "string",  description: "Email address" },
        phone:         { type: "string",  description: "Phone number" },
        is_company:    { type: "boolean", description: "True if company" },
        customer_rank: { type: "number",  description: "Set 1 to mark as customer" },
        supplier_rank: { type: "number",  description: "Set 1 to mark as supplier" },
        city:          { type: "string",  description: "City" },
        street:        { type: "string",  description: "Street address" },
      },
      required: ["name"],
    },
  },
  {
    name: "search_sales_orders",
    description: "Search for sales orders in Odoo",
    inputSchema: {
      type: "object",
      properties: {
        state:         { type: "string", description: "State: draft, sent, sale, done, cancel" },
        customer_name: { type: "string", description: "Filter by customer name" },
        limit:         { type: "number", description: "Max results (default 10)" },
      },
    },
  },
  {
    name: "create_sales_order",
    description: "Create a new sales order in Odoo",
    inputSchema: {
      type: "object",
      properties: {
        partner_id: { type: "number", description: "Customer ID (use search_partners first)" },
        order_lines: {
          type: "array",
          description: "List of order lines",
          items: {
            type: "object",
            properties: {
              product_id:      { type: "number", description: "Product ID" },
              product_uom_qty: { type: "number", description: "Quantity" },
              price_unit:      { type: "number", description: "Unit price" },
            },
          },
        },
      },
      required: ["partner_id"],
    },
  },
  {
    name: "search_products",
    description: "Search for products in Odoo",
    inputSchema: {
      type: "object",
      properties: {
        name:  { type: "string", description: "Filter by product name" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
    },
  },
  {
    name: "search_invoices",
    description: "Search for customer invoices in Odoo",
    inputSchema: {
      type: "object",
      properties: {
        state:         { type: "string", description: "State: draft, posted, cancel" },
        customer_name: { type: "string", description: "Filter by customer name" },
        limit:         { type: "number", description: "Max results (default 10)" },
      },
    },
  },
  {
    name: "get_stock",
    description: "Get stock / inventory levels for products",
    inputSchema: {
      type: "object",
      properties: {
        product_name: { type: "string", description: "Filter by product name" },
        limit:        { type: "number", description: "Max results (default 10)" },
      },
    },
  },
  {
    name: "search_purchase_orders",
    description: "Search for purchase orders in Odoo",
    inputSchema: {
      type: "object",
      properties: {
        state:         { type: "string", description: "State: draft, purchase, done, cancel" },
        supplier_name: { type: "string", description: "Filter by supplier name" },
        limit:         { type: "number", description: "Max results (default 10)" },
      },
    },
  },
  {
    name: "create_product",
    description: "Create a new product in Odoo",
    inputSchema: {
      type: "object",
      properties: {
        name:           { type: "string",  description: "Product name (required)" },
        list_price:     { type: "number",  description: "Sales price" },
        standard_price: { type: "number",  description: "Cost price" },
        default_code:   { type: "string",  description: "Internal reference / SKU" },
        type:           { type: "string",  description: "Product type: consu (consumable), service, or product (storable)" },
        categ_id:       { type: "number",  description: "Product category ID" },
        description:    { type: "string",  description: "Internal notes / description" },
        barcode:        { type: "string",  description: "Barcode (EAN, UPC, etc.)" },
      },
      required: ["name"],
    },
  },
  // ── CRM Tools ──────────────────────────────────────────────────
  {
    name: "search_crm_leads",
    description: "Search CRM leads and opportunities in Odoo",
    inputSchema: {
      type: "object",
      properties: {
        type:          { type: "string",  description: "Record type: 'lead' or 'opportunity'" },
        stage_name:    { type: "string",  description: "Filter by stage name (partial match)" },
        partner_name:  { type: "string",  description: "Filter by customer/company name" },
        user_name:     { type: "string",  description: "Filter by salesperson name" },
        priority:      { type: "string",  description: "Priority: '0' (normal), '1' (low), '2' (high), '3' (very high)" },
        active:        { type: "boolean", description: "true for active (default), false for archived" },
        limit:         { type: "number",  description: "Max results (default 10)" },
      },
    },
  },
  {
    name: "create_crm_lead",
    description: "Create a new CRM lead or opportunity in Odoo",
    inputSchema: {
      type: "object",
      properties: {
        name:               { type: "string",  description: "Lead/opportunity title (required)" },
        type:               { type: "string",  description: "'lead' or 'opportunity' (default: lead)" },
        partner_name:       { type: "string",  description: "Company/customer name" },
        contact_name:       { type: "string",  description: "Contact person name" },
        email_from:         { type: "string",  description: "Email address" },
        phone:              { type: "string",  description: "Phone number" },
        mobile:             { type: "string",  description: "Mobile number" },
        stage_id:           { type: "number",  description: "Pipeline stage ID (use get_crm_stages to list)" },
        priority:           { type: "string",  description: "Priority: '0' normal, '1' low, '2' high, '3' very high" },
        expected_revenue:   { type: "number",  description: "Expected revenue amount" },
        probability:        { type: "number",  description: "Win probability 0-100" },
        description:        { type: "string",  description: "Internal notes" },
        street:             { type: "string",  description: "Street address" },
        city:               { type: "string",  description: "City" },
        tag_ids:            { type: "array", items: { type: "number" }, description: "Tag IDs to assign" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_crm_lead",
    description: "Update fields on an existing CRM lead or opportunity",
    inputSchema: {
      type: "object",
      properties: {
        id:                 { type: "number",  description: "Lead/opportunity ID to update (required)" },
        name:               { type: "string",  description: "New title" },
        type:               { type: "string",  description: "'lead' or 'opportunity'" },
        partner_name:       { type: "string",  description: "Company/customer name" },
        contact_name:       { type: "string",  description: "Contact person name" },
        email_from:         { type: "string",  description: "Email address" },
        phone:              { type: "string",  description: "Phone number" },
        stage_id:           { type: "number",  description: "Pipeline stage ID" },
        priority:           { type: "string",  description: "Priority: '0','1','2','3'" },
        expected_revenue:   { type: "number",  description: "Expected revenue" },
        probability:        { type: "number",  description: "Win probability 0-100" },
        description:        { type: "string",  description: "Internal notes" },
        active:             { type: "boolean", description: "false to archive the record" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_crm_lead",
    description: "Archive (soft-delete) or permanently delete a CRM lead/opportunity",
    inputSchema: {
      type: "object",
      properties: {
        id:        { type: "number",  description: "Lead/opportunity ID (required)" },
        permanent: { type: "boolean", description: "true to permanently delete; false (default) to archive" },
      },
      required: ["id"],
    },
  },
  {
    name: "convert_to_opportunity",
    description: "Convert a CRM lead into an opportunity and optionally link a partner",
    inputSchema: {
      type: "object",
      properties: {
        id:         { type: "number", description: "Lead ID to convert (required)" },
        stage_id:   { type: "number", description: "Target pipeline stage ID" },
        partner_id: { type: "number", description: "Existing Odoo partner ID to link" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_crm_stages",
    description: "List all CRM pipeline stages",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },
  {
    name: "get_crm_tags",
    description: "List available CRM tags",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },
  {
    name: "odoo_search",
    description: "Advanced: search any Odoo model with a custom domain",
    inputSchema: {
      type: "object",
      properties: {
        model:  { type: "string", description: "Odoo model e.g. res.partner, sale.order" },
        domain: { type: "string", description: 'JSON domain e.g. [["name","ilike","Apple"]]' },
        fields: { type: "array", items: { type: "string" }, description: "Fields to return" },
        limit:  { type: "number", description: "Max results" },
      },
      required: ["model"],
    },
  },
];

// ── Execute Tool ──────────────────────────────────────────────────
async function executeTool(name, p = {}) {
  if (name === "search_partners") {
    const domain = [];
    if (p.name)        domain.push(["name", "ilike", p.name]);
    if (p.is_customer) domain.push(["customer_rank", ">", 0]);
    if (p.is_supplier) domain.push(["supplier_rank", ">", 0]);
    return callOdoo("res.partner", "search_read", [domain], {
      fields: ["id", "name", "email", "phone", "customer_rank", "supplier_rank", "city", "country_id"],
      limit: p.limit || 10,
    });
  }
  if (name === "create_partner") {
    const id = await callOdoo("res.partner", "create", [p]);
    return { success: true, id, message: `Partner created with ID ${id}` };
  }
  if (name === "search_sales_orders") {
    const domain = [];
    if (p.state)         domain.push(["state", "=", p.state]);
    if (p.customer_name) domain.push(["partner_id.name", "ilike", p.customer_name]);
    return callOdoo("sale.order", "search_read", [domain], {
      fields: ["id", "name", "partner_id", "state", "amount_total", "date_order"],
      limit: p.limit || 10,
    });
  }
  if (name === "create_sales_order") {
    const vals = { partner_id: p.partner_id };
    if (p.order_lines) {
      vals.order_line = p.order_lines.map((l) => [
        0, 0,
        { product_id: l.product_id, product_uom_qty: l.product_uom_qty || 1, price_unit: l.price_unit || 0 },
      ]);
    }
    const id = await callOdoo("sale.order", "create", [vals]);
    return { success: true, id, message: `Sales order created with ID ${id}` };
  }
  if (name === "search_products") {
    const domain = [];
    if (p.name) domain.push(["name", "ilike", p.name]);
    return callOdoo("product.template", "search_read", [domain], {
      fields: ["id", "name", "list_price", "qty_available", "categ_id", "type", "default_code"],
      limit: p.limit || 10,
    });
  }
  if (name === "search_invoices") {
    const domain = [["move_type", "=", "out_invoice"]];
    if (p.state)         domain.push(["state", "=", p.state]);
    if (p.customer_name) domain.push(["partner_id.name", "ilike", p.customer_name]);
    return callOdoo("account.move", "search_read", [domain], {
      fields: ["id", "name", "partner_id", "state", "amount_total", "invoice_date", "invoice_date_due"],
      limit: p.limit || 10,
    });
  }
  if (name === "get_stock") {
    const domain = [];
    if (p.product_name) domain.push(["product_id.name", "ilike", p.product_name]);
    return callOdoo("stock.quant", "search_read", [domain], {
      fields: ["product_id", "location_id", "quantity", "reserved_quantity"],
      limit: p.limit || 10,
    });
  }
  if (name === "search_purchase_orders") {
    const domain = [];
    if (p.state)         domain.push(["state", "=", p.state]);
    if (p.supplier_name) domain.push(["partner_id.name", "ilike", p.supplier_name]);
    return callOdoo("purchase.order", "search_read", [domain], {
      fields: ["id", "name", "partner_id", "state", "amount_total", "date_order"],
      limit: p.limit || 10,
    });
  }
  if (name === "create_product") {
    const vals = { name: p.name };
    if (p.list_price     !== undefined) vals.list_price     = p.list_price;
    if (p.standard_price !== undefined) vals.standard_price = p.standard_price;
    if (p.default_code   !== undefined) vals.default_code   = p.default_code;
    if (p.type           !== undefined) vals.type           = p.type;
    if (p.categ_id       !== undefined) vals.categ_id       = p.categ_id;
    if (p.description    !== undefined) vals.description    = p.description;
    if (p.barcode        !== undefined) vals.barcode        = p.barcode;
    const id = await callOdoo("product.template", "create", [vals]);
    return { success: true, id, message: `Product created with ID ${id}` };
  }
  // ── CRM Handlers ─────────────────────────────────────────────────
  if (name === "search_crm_leads") {
    const domain = [];
    if (p.type)         domain.push(["type", "=", p.type]);
    if (p.stage_name)   domain.push(["stage_id.name", "ilike", p.stage_name]);
    if (p.partner_name) domain.push(["partner_name", "ilike", p.partner_name]);
    if (p.user_name)    domain.push(["user_id.name", "ilike", p.user_name]);
    if (p.priority)     domain.push(["priority", "=", p.priority]);
    // default to active=true unless caller explicitly sets false
    domain.push(["active", "=", p.active !== undefined ? p.active : true]);
    return callOdoo("crm.lead", "search_read", [domain], {
      fields: [
        "id", "name", "type", "partner_name", "contact_name", "email_from",
        "phone", "stage_id", "priority", "expected_revenue", "probability",
        "user_id", "team_id", "create_date", "date_deadline",
      ],
      limit: p.limit || 10,
    });
  }
  if (name === "create_crm_lead") {
    const vals = { name: p.name, type: p.type || "lead" };
    const fields = [
      "partner_name", "contact_name", "email_from", "phone", "mobile",
      "stage_id", "priority", "expected_revenue", "probability",
      "description", "street", "city",
    ];
    for (const f of fields) {
      if (p[f] !== undefined) vals[f] = p[f];
    }
    if (p.tag_ids && p.tag_ids.length) {
      vals.tag_ids = [[6, 0, p.tag_ids]]; // Odoo many2many replace command
    }
    const id = await callOdoo("crm.lead", "create", [vals]);
    return { success: true, id, message: `CRM ${vals.type} created with ID ${id}` };
  }
  if (name === "update_crm_lead") {
    const { id, ...rest } = p;
    if (!Object.keys(rest).length) throw new Error("No fields provided to update");
    await callOdoo("crm.lead", "write", [[id], rest]);
    return { success: true, id, message: `CRM lead/opportunity ${id} updated` };
  }
  if (name === "delete_crm_lead") {
    if (p.permanent) {
      await callOdoo("crm.lead", "unlink", [[p.id]]);
      return { success: true, message: `CRM record ${p.id} permanently deleted` };
    }
    await callOdoo("crm.lead", "write", [[p.id], { active: false }]);
    return { success: true, message: `CRM record ${p.id} archived` };
  }
  if (name === "convert_to_opportunity") {
    const vals = { type: "opportunity" };
    if (p.stage_id)   vals.stage_id   = p.stage_id;
    if (p.partner_id) vals.partner_id = p.partner_id;
    await callOdoo("crm.lead", "write", [[p.id], vals]);
    return { success: true, id: p.id, message: `Lead ${p.id} converted to opportunity` };
  }
  if (name === "get_crm_stages") {
    return callOdoo("crm.stage", "search_read", [[]], {
      fields: ["id", "name", "sequence", "probability", "fold"],
      limit: p.limit || 20,
    });
  }
  if (name === "get_crm_tags") {
    return callOdoo("crm.tag", "search_read", [[]], {
      fields: ["id", "name"],
      limit: p.limit || 20,
    });
  }
  if (name === "odoo_search") {
    const domain = p.domain ? JSON.parse(p.domain) : [];
    return callOdoo(p.model, "search_read", [domain], {
      fields: p.fields || [],
      limit: p.limit || 10,
    });
  }
  throw new Error(`Unknown tool: ${name}`);
}

// ── Handle MCP JSON-RPC Message ───────────────────────────────────
async function handleMcpMessage(msg) {
  const { method, id, params } = msg;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "Odoo MCP Server", version: "3.0.0" },
      },
    };
  }

  if (method === "notifications/initialized") {
    return null; // no response needed
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0", id,
      result: { tools: TOOLS },
    };
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    console.log(`[TOOL] ${name}`, JSON.stringify(args));
    try {
      const data = await executeTool(name, args || {});
      return {
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true },
      };
    }
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  return {
    jsonrpc: "2.0", id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

// ════════════════════════════════════════════════════════════════════
//  ROOT MCP ENDPOINT  /
//  Claude.ai uses root path with Streamable HTTP transport
// ════════════════════════════════════════════════════════════════════

// HEAD / — protocol discovery
app.head("/", (req, res) => {
  res.set("MCP-Protocol-Version", "2024-11-05");
  res.set("Allow", "GET, POST, HEAD, OPTIONS, DELETE");
  res.status(200).end();
});

// GET / — SSE stream (for clients that still use SSE)
app.get("/", (req, res) => {
  const accept = req.headers["accept"] || "";

  if (accept.includes("text/event-stream")) {
    // SSE mode
    const sessionId = randomUUID();
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Mcp-Session-Id": sessionId,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.flushHeaders();

    console.log(`[SSE] session=${sessionId}`);

    // Keep-alive
    const ka = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => clearInterval(ka));
    return;
  }

  // Plain GET — return server info
  res.set("MCP-Protocol-Version", "2024-11-05");
  res.json({
    name: "Odoo MCP Server",
    version: "3.0.0",
    protocol: "MCP 2024-11-05",
    transport: "Streamable HTTP",
  });
});

// POST / — main MCP message handler (Streamable HTTP)
app.post("/", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] || randomUUID();
  const accept = req.headers["accept"] || "";
  const body = req.body;

  console.log(`[MCP] method=${body?.method} session=${sessionId}`);

  const response = await handleMcpMessage(body);

  // If client wants SSE response stream
  if (accept.includes("text/event-stream")) {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Mcp-Session-Id": sessionId,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.flushHeaders();

    if (response) {
      res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
    }
    res.end();
    return;
  }

  // Standard JSON response
  res.set({
    "Content-Type": "application/json",
    "Mcp-Session-Id": sessionId,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    "MCP-Protocol-Version": "2024-11-05",
  });

  if (response === null) {
    return res.status(202).end();
  }

  res.status(200).json(response);
});

// DELETE / — session termination
app.delete("/", (req, res) => {
  res.status(200).json({ status: "session terminated" });
});

// ════════════════════════════════════════════════════════════════════
//  Legacy /sse endpoint  (keep for backward compat)
// ════════════════════════════════════════════════════════════════════
app.get("/sse", (req, res) => {
  const sessionId = randomUUID();
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Mcp-Session-Id": sessionId,
    "Access-Control-Allow-Origin": "*",
  });
  res.flushHeaders();
  res.write(`event: endpoint\ndata: ${JSON.stringify({ uri: `/messages?sessionId=${sessionId}` })}\n\n`);
  const ka = setInterval(() => res.write(": ping\n\n"), 20000);
  req.on("close", () => clearInterval(ka));
});

// ── OAuth Discovery  (no-auth mode — return empty/passthrough) ────
app.get("/.well-known/oauth-protected-resource", (req, res) => {
  res.json({ resource: req.protocol + "://" + req.get("host"), authorization_servers: [] });
});
app.get("/.well-known/oauth-protected-resource/sse", (req, res) => {
  res.json({ resource: req.protocol + "://" + req.get("host"), authorization_servers: [] });
});
app.get("/.well-known/oauth-authorization-server", (req, res) => res.json({}));
app.post("/register", (req, res) => {
  res.status(201).json({ client_id: randomUUID(), client_secret: randomUUID() });
});

// ── Health Check ──────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  try {
    const uid = await authenticate();
    res.json({ status: "ok", odoo_connected: true, uid, odoo_url: ODOO_URL, db: ODOO_DB });
  } catch (err) {
    res.status(500).json({ status: "error", odoo_connected: false, error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Odoo MCP Server v3 running on port ${PORT}`);
  console.log(`   Transport    : Streamable HTTP (MCP 2024-11-05)`);
  console.log(`   MCP Endpoint : /  (POST for messages, GET for SSE)`);
  console.log(`   Health       : /health`);
  console.log(`   Odoo         : ${ODOO_URL} | DB: ${ODOO_DB}\n`);
});
