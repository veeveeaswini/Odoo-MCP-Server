// ─────────────────────────────────────────────────────────────────
//  Odoo MCP Server
//  Connects Claude.ai to your Odoo instance via the MCP protocol
// ─────────────────────────────────────────────────────────────────

import express from "express";
import cors from "cors";
import xmlrpc from "xmlrpc";
import { config } from "dotenv";

config(); // Load .env

const app = express();
app.use(cors());
app.use(express.json());

// ── Config ────────────────────────────────────────────────────────
const ODOO_URL   = process.env.ODOO_URL   || "https://your-odoo.com";
const ODOO_DB    = process.env.ODOO_DB    || "your-db";
const ODOO_KEY   = process.env.ODOO_API_KEY || "your-api-key";
const PORT       = process.env.PORT       || 3000;

// ── Odoo XML-RPC Helper ───────────────────────────────────────────
function callOdoo(model, method, args, kwargs = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(ODOO_URL);
    const options = {
      host: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: "/xmlrpc/2/object",
    };

    const client =
      url.protocol === "https:"
        ? xmlrpc.createSecureClient(options)
        : xmlrpc.createClient(options);

    // UID=2 is typically admin; Odoo accepts API key as password with uid
    client.methodCall(
      "execute_kw",
      [ODOO_DB, 2, ODOO_KEY, model, method, args, kwargs],
      (err, value) => {
        if (err) reject(err);
        else resolve(value);
      }
    );
  });
}

// ── MCP Manifest — Claude reads this to discover available tools ──
app.get("/.well-known/mcp.json", (req, res) => {
  res.json({
    schema_version: "v1",
    name: "Odoo Connector",
    description: "Connect Claude to your Odoo ERP — search, create, and manage business records.",
    tools: [
      // ── Partners / Customers ──────────────────────────────────
      {
        name: "search_partners",
        description: "Search for customers, suppliers, or contacts in Odoo",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Filter by name (partial match)" },
            is_customer: { type: "boolean", description: "Filter only customers" },
            is_supplier: { type: "boolean", description: "Filter only suppliers" },
            limit: { type: "number", description: "Max results (default 10)" },
          },
        },
      },
      {
        name: "create_partner",
        description: "Create a new customer or supplier contact in Odoo",
        parameters: {
          type: "object",
          properties: {
            name:    { type: "string", description: "Full name of the contact" },
            email:   { type: "string", description: "Email address" },
            phone:   { type: "string", description: "Phone number" },
            is_company: { type: "boolean", description: "True if this is a company" },
            customer_rank: { type: "number", description: "Set to 1 to mark as customer" },
            supplier_rank: { type: "number", description: "Set to 1 to mark as supplier" },
          },
          required: ["name"],
        },
      },

      // ── Sales Orders ──────────────────────────────────────────
      {
        name: "search_sales_orders",
        description: "Search for sales orders in Odoo",
        parameters: {
          type: "object",
          properties: {
            state: {
              type: "string",
              description: "Order state: draft, sent, sale, done, cancel",
            },
            customer_name: { type: "string", description: "Filter by customer name" },
            limit: { type: "number", description: "Max results (default 10)" },
          },
        },
      },
      {
        name: "create_sales_order",
        description: "Create a new sales order in Odoo",
        parameters: {
          type: "object",
          properties: {
            partner_id: { type: "number", description: "Customer ID (get from search_partners)" },
            order_lines: {
              type: "array",
              description: "Array of order lines",
              items: {
                type: "object",
                properties: {
                  product_id: { type: "number", description: "Product ID" },
                  product_uom_qty: { type: "number", description: "Quantity" },
                  price_unit: { type: "number", description: "Unit price" },
                },
              },
            },
          },
          required: ["partner_id"],
        },
      },

      // ── Products ──────────────────────────────────────────────
      {
        name: "search_products",
        description: "Search for products in Odoo inventory",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Filter by product name" },
            category: { type: "string", description: "Filter by category name" },
            limit: { type: "number", description: "Max results (default 10)" },
          },
        },
      },

      // ── Invoices ──────────────────────────────────────────────
      {
        name: "search_invoices",
        description: "Search for customer invoices in Odoo",
        parameters: {
          type: "object",
          properties: {
            state: {
              type: "string",
              description: "Invoice state: draft, posted, cancel",
            },
            customer_name: { type: "string", description: "Filter by customer name" },
            limit: { type: "number", description: "Max results (default 10)" },
          },
        },
      },

      // ── Generic (Advanced) ────────────────────────────────────
      {
        name: "odoo_search",
        description: "Advanced: search any Odoo model with a custom domain filter",
        parameters: {
          type: "object",
          properties: {
            model:  { type: "string", description: "Odoo model name e.g. res.partner, sale.order" },
            domain: { type: "string", description: "Odoo domain filter as JSON array e.g. [[\"name\",\"ilike\",\"Apple\"]]" },
            fields: { type: "array", items: { type: "string" }, description: "Fields to return" },
            limit:  { type: "number", description: "Max results" },
          },
          required: ["model"],
        },
      },
    ],
  });
});

// ── MCP Tool Call Handler ─────────────────────────────────────────
app.post("/mcp/call", async (req, res) => {
  const { tool, parameters: p = {} } = req.body;

  try {
    let result;

    // ── search_partners ────────────────────────────────────────
    if (tool === "search_partners") {
      const domain = [];
      if (p.name) domain.push(["name", "ilike", p.name]);
      if (p.is_customer) domain.push(["customer_rank", ">", 0]);
      if (p.is_supplier) domain.push(["supplier_rank", ">", 0]);

      result = await callOdoo("res.partner", "search_read", [domain], {
        fields: ["id", "name", "email", "phone", "customer_rank", "supplier_rank", "city", "country_id"],
        limit: p.limit || 10,
      });
    }

    // ── create_partner ─────────────────────────────────────────
    else if (tool === "create_partner") {
      const id = await callOdoo("res.partner", "create", [p]);
      result = { success: true, id, message: `Partner created with ID ${id}` };
    }

    // ── search_sales_orders ────────────────────────────────────
    else if (tool === "search_sales_orders") {
      const domain = [["move_type", "=", "out_invoice"]]; // not needed for sale.order
      const soDomain = [];
      if (p.state) soDomain.push(["state", "=", p.state]);
      if (p.customer_name) soDomain.push(["partner_id.name", "ilike", p.customer_name]);

      result = await callOdoo("sale.order", "search_read", [soDomain], {
        fields: ["id", "name", "partner_id", "state", "amount_total", "date_order"],
        limit: p.limit || 10,
      });
    }

    // ── create_sales_order ─────────────────────────────────────
    else if (tool === "create_sales_order") {
      const vals = { partner_id: p.partner_id };
      if (p.order_lines) {
        vals.order_line = p.order_lines.map((line) => [
          0, 0,
          {
            product_id: line.product_id,
            product_uom_qty: line.product_uom_qty || 1,
            price_unit: line.price_unit || 0,
          },
        ]);
      }
      const id = await callOdoo("sale.order", "create", [vals]);
      result = { success: true, id, message: `Sales order created with ID ${id}` };
    }

    // ── search_products ────────────────────────────────────────
    else if (tool === "search_products") {
      const domain = [];
      if (p.name) domain.push(["name", "ilike", p.name]);

      result = await callOdoo("product.template", "search_read", [domain], {
        fields: ["id", "name", "list_price", "qty_available", "categ_id", "type"],
        limit: p.limit || 10,
      });
    }

    // ── search_invoices ────────────────────────────────────────
    else if (tool === "search_invoices") {
      const domain = [["move_type", "=", "out_invoice"]];
      if (p.state) domain.push(["state", "=", p.state]);
      if (p.customer_name) domain.push(["partner_id.name", "ilike", p.customer_name]);

      result = await callOdoo("account.move", "search_read", [domain], {
        fields: ["id", "name", "partner_id", "state", "amount_total", "invoice_date", "invoice_date_due"],
        limit: p.limit || 10,
      });
    }

    // ── odoo_search (generic) ──────────────────────────────────
    else if (tool === "odoo_search") {
      const domain = p.domain ? JSON.parse(p.domain) : [];
      result = await callOdoo(p.model, "search_read", [domain], {
        fields: p.fields || [],
        limit: p.limit || 10,
      });
    }

    else {
      return res.status(400).json({ error: `Unknown tool: ${tool}` });
    }

    res.json({ result });
  } catch (err) {
    console.error(`[MCP Error] tool=${tool}`, err.message);
    res.status(500).json({
      error: err.message,
      hint: "Check your ODOO_URL, ODOO_DB, and ODOO_API_KEY in .env",
    });
  }
});

// ── Health Check ──────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: "Odoo MCP Server",
    odoo_url: ODOO_URL,
    timestamp: new Date().toISOString(),
  });
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Odoo MCP Server running on port ${PORT}`);
  console.log(`   MCP Manifest : http://localhost:${PORT}/.well-known/mcp.json`);
  console.log(`   Tool Handler : http://localhost:${PORT}/mcp/call`);
  console.log(`   Health Check : http://localhost:${PORT}/health\n`);
});
