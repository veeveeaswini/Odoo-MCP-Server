// ─────────────────────────────────────────────────────────────────
//  Odoo MCP Server  —  Claude.ai Compatible (SSE + OAuth Discovery)
//  Works with Odoo Community Edition (username + password login)
// ─────────────────────────────────────────────────────────────────

import express from "express";
import cors from "cors";
import xmlrpc from "xmlrpc";
import { config } from "dotenv";
import { randomUUID } from "crypto";

config();

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "Mcp-Session-Id"],
}));

app.use(express.json());

// ── Config ────────────────────────────────────────────────────────
const ODOO_URL  = process.env.ODOO_URL   || "http://localhost:8069";
const ODOO_DB   = process.env.ODOO_DB    || "odoo";
const ODOO_USER = process.env.ODOO_USER  || "admin";
const ODOO_PASS = process.env.ODOO_PASS  || "admin";
const PORT      = process.env.PORT       || 3000;
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

// ── Odoo XML-RPC: Authenticate ────────────────────────────────────
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
      if (!uid) return reject(new Error("Authentication failed — check ODOO_USER and ODOO_PASS"));
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
      (err, value) => {
        if (err) reject(err);
        else resolve(value);
      }
    );
  });
}

// ── MCP Tool Definitions ──────────────────────────────────────────
const MCP_TOOLS = [
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
        name:          { type: "string",  description: "Full name of the contact" },
        email:         { type: "string",  description: "Email address" },
        phone:         { type: "string",  description: "Phone number" },
        is_company:    { type: "boolean", description: "True if this is a company" },
        customer_rank: { type: "number",  description: "Set to 1 to mark as customer" },
        supplier_rank: { type: "number",  description: "Set to 1 to mark as supplier" },
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
        state:         { type: "string", description: "Order state: draft, sent, sale, done, cancel" },
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
        partner_id: { type: "number", description: "Customer ID (use search_partners to find)" },
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
        state:         { type: "string", description: "Invoice state: draft, posted, cancel" },
        customer_name: { type: "string", description: "Filter by customer name" },
        limit:         { type: "number", description: "Max results (default 10)" },
      },
    },
  },
  {
    name: "get_stock",
    description: "Get stock/inventory levels for products in Odoo Community",
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
        state:         { type: "string", description: "Order state: draft, purchase, done, cancel" },
        supplier_name: { type: "string", description: "Filter by supplier name" },
        limit:         { type: "number", description: "Max results (default 10)" },
      },
    },
  },
  {
    name: "odoo_search",
    description: "Advanced: search any Odoo model with a custom domain filter",
    inputSchema: {
      type: "object",
      properties: {
        model:  { type: "string", description: "Odoo model e.g. res.partner, sale.order, account.move" },
        domain: { type: "string", description: 'Domain filter as JSON e.g. [["name","ilike","Apple"]]' },
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

  if (name === "odoo_search") {
    const domain = p.domain ? JSON.parse(p.domain) : [];
    return callOdoo(p.model, "search_read", [domain], {
      fields: p.fields || [],
      limit: p.limit || 10,
    });
  }

  throw new Error(`Unknown tool: ${name}`);
}

// ── SSE Helper ────────────────────────────────────────────────────
function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ── Active SSE Sessions ───────────────────────────────────────────
const sessions = new Map();

// ════════════════════════════════════════════════════════════════════
//  OAuth Discovery Endpoints  (Claude.ai checks these first)
// ════════════════════════════════════════════════════════════════════

app.get("/.well-known/oauth-protected-resource", (req, res) => {
  res.json({
    resource: SERVER_URL,
    authorization_servers: [],
    bearer_methods_supported: [],
  });
});

app.get("/.well-known/oauth-protected-resource/sse", (req, res) => {
  res.json({
    resource: SERVER_URL,
    authorization_servers: [],
  });
});

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json({});
});

app.post("/register", (req, res) => {
  // Dynamic client registration — return a dummy client_id
  res.status(201).json({
    client_id: randomUUID(),
    client_secret: randomUUID(),
    registration_access_token: randomUUID(),
  });
});

// ════════════════════════════════════════════════════════════════════
//  SSE Endpoint  — Claude.ai connects here
// ════════════════════════════════════════════════════════════════════

app.get("/sse", (req, res) => {
  const sessionId = randomUUID();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  console.log(`[SSE] New session: ${sessionId}`);
  sessions.set(sessionId, res);

  // Send the endpoint URL so Claude.ai knows where to POST messages
  sendSSE(res, "endpoint", { uri: `/messages?sessionId=${sessionId}` });

  // Keep-alive ping every 20 seconds
  const keepAlive = setInterval(() => {
    res.write(": ping\n\n");
  }, 20000);

  req.on("close", () => {
    console.log(`[SSE] Session closed: ${sessionId}`);
    clearInterval(keepAlive);
    sessions.delete(sessionId);
  });
});

// ════════════════════════════════════════════════════════════════════
//  Messages Endpoint  — Claude.ai POSTs JSON-RPC here
// ════════════════════════════════════════════════════════════════════

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const sseRes    = sessions.get(sessionId);

  if (!sseRes) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.status(202).json({ status: "accepted" });

  const msg = req.body;
  console.log(`[MSG] method=${msg.method} id=${msg.id}`);

  try {
    // ── initialize ──────────────────────────────────────────────
    if (msg.method === "initialize") {
      sendSSE(sseRes, "message", {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "Odoo MCP Server", version: "2.0.0" },
        },
      });
    }

    // ── tools/list ──────────────────────────────────────────────
    else if (msg.method === "tools/list") {
      sendSSE(sseRes, "message", {
        jsonrpc: "2.0",
        id: msg.id,
        result: { tools: MCP_TOOLS },
      });
    }

    // ── tools/call ──────────────────────────────────────────────
    else if (msg.method === "tools/call") {
      const { name, arguments: args } = msg.params;
      console.log(`[TOOL] ${name}`, args);

      try {
        const result = await executeTool(name, args || {});
        sendSSE(sseRes, "message", {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          },
        });
      } catch (toolErr) {
        sendSSE(sseRes, "message", {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            content: [{ type: "text", text: `Error: ${toolErr.message}` }],
            isError: true,
          },
        });
      }
    }

    // ── notifications/initialized (no response needed) ──────────
    else if (msg.method === "notifications/initialized") {
      console.log("[MCP] Client initialized ✅");
    }

    // ── unknown method ───────────────────────────────────────────
    else {
      sendSSE(sseRes, "message", {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      });
    }
  } catch (err) {
    console.error("[Server Error]", err.message);
    sendSSE(sseRes, "message", {
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32603, message: err.message },
    });
  }
});

// Also handle POST /sse (some MCP clients POST directly to /sse)
app.post("/sse", async (req, res) => {
  // Redirect to /messages without a session — create a quick inline response
  res.status(200).json({ error: "Use GET /sse to establish SSE session first" });
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

app.get("/", (req, res) => {
  res.json({
    name: "Odoo MCP Server",
    version: "2.0.0",
    status: "running",
    endpoints: {
      sse:    "/sse",
      health: "/health",
    },
  });
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Odoo MCP Server (Community Edition) running on port ${PORT}`);
  console.log(`   SSE Endpoint : ${SERVER_URL}/sse`);
  console.log(`   Health Check : ${SERVER_URL}/health`);
  console.log(`   Odoo URL     : ${ODOO_URL}`);
  console.log(`   Database     : ${ODOO_DB}\n`);
});
