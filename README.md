# Odoo MCP Server

Connect **Claude.ai** to your Odoo instance — search customers, manage sales orders, check invoices, and more, all from Claude chat.

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/odoo-mcp-server
cd odoo-mcp-server
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your Odoo details:

```env
ODOO_URL=https://your-company.odoo.com
ODOO_DB=your-database-name
ODOO_API_KEY=your_api_key_here
PORT=3000
```

**How to get your Odoo API Key:**
1. Log into Odoo
2. Go to **Settings → Users → Your User**
3. Click **API Keys → New**
4. Give it a name → Copy the key

### 3. Run Locally (for testing)

```bash
npm start
```

Visit http://localhost:3000/health to confirm it's running.

---

## Deploy to Railway (Free HTTPS hosting)

Railway gives you a free public HTTPS URL — required for Claude.ai.

### Steps:

1. Push your code to GitHub
2. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub**
3. Select your repo
4. Go to **Variables** tab → add your 3 env vars:
   - `ODOO_URL`
   - `ODOO_DB`
   - `ODOO_API_KEY`
5. Railway auto-deploys and gives you a URL like:
   `https://odoo-mcp-server-production.up.railway.app`

---

## Connect to Claude.ai

1. Open [claude.ai](https://claude.ai)
2. Go to **Settings → Connectors → Add Custom Connector**
3. Paste your Railway URL:
   `https://your-app.up.railway.app`
4. Claude reads the MCP manifest and discovers all tools
5. Click **Connect** ✅

---

## Available Tools

| Tool | What it does |
|------|-------------|
| `search_partners` | Search customers, suppliers, contacts |
| `create_partner` | Create a new contact |
| `search_sales_orders` | Find sales orders by state or customer |
| `create_sales_order` | Create a new sales order |
| `search_products` | Browse product catalog |
| `search_invoices` | Find customer invoices |
| `odoo_search` | Advanced: query any Odoo model |

---

## Example Claude Prompts

Once connected, try these in Claude.ai:

- *"Show me all customers in Odoo"*
- *"Find open sales orders"*
- *"Create a new contact named John Smith with email john@acme.com"*
- *"List all unpaid invoices"*
- *"Search for products with 'laptop' in the name"*

---

## Troubleshooting

**500 error from Odoo?**
- Double-check `ODOO_URL` has no trailing slash
- Make sure `ODOO_DB` matches exactly (case-sensitive)
- Regenerate your API key and update `.env`

**Claude can't find the connector?**
- Make sure the server is running and publicly accessible
- Visit `https://your-url/.well-known/mcp.json` in browser — should return JSON
