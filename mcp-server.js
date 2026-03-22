const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ── Mock Data ────────────────────────────────────────────────────────────────

function generateSalesTrend(sku, days = 60) {
  const data = [];
  const today = new Date();
  let base = 420;

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayOfWeek = d.getDay();
    const weekendBump = dayOfWeek === 0 || dayOfWeek === 6 ? 1.35 : 1.0;
    const trend = 1 + (days - 1 - i) * 0.003;
    const noise = 0.85 + Math.random() * 0.3;
    const units = Math.round((base * weekendBump * trend * noise) / 60);
    data.push({ date: d.toISOString().split('T')[0], units });
    base += Math.random() * 4 - 1;
  }

  return data;
}

function generateStoreData() {
  const stores = [
    { id: 'NYC-001', name: 'Manhattan Flagship', region: 'Northeast' },
    { id: 'LA-001',  name: 'Beverly Hills', region: 'West' },
    { id: 'CHI-001', name: 'Michigan Ave', region: 'Midwest' },
    { id: 'MIA-001', name: 'Brickell City Centre', region: 'South' },
    { id: 'SEA-001', name: 'Pike Place', region: 'West' },
    { id: 'BOS-001', name: 'Newbury Street', region: 'Northeast' },
    { id: 'ATL-001', name: 'Buckhead', region: 'South' },
    { id: 'DAL-001', name: 'NorthPark Center', region: 'South' },
  ];

  return stores.map((s) => {
    const inventory = Math.floor(Math.random() * 120) + 20;
    const sold = Math.floor(Math.random() * 200) + 80;
    const allocated = inventory + sold;
    const sellThrough = Math.round((sold / allocated) * 100);
    const velocity = +(sold / 60).toFixed(1);
    const weeksOfSupply = +(inventory / (velocity * 7)).toFixed(1);

    return {
      ...s,
      inventory,
      sold_60d: sold,
      sell_through_pct: sellThrough,
      daily_velocity: velocity,
      weeks_of_supply: weeksOfSupply,
      stock_risk: weeksOfSupply < 1.5 ? 'critical' : weeksOfSupply < 3 ? 'watch' : 'healthy',
    };
  });
}

function generateReorderActions(stores) {
  return stores
    .filter((s) => s.stock_risk !== 'healthy')
    .map((s) => ({
      store_id: s.id,
      store_name: s.name,
      risk_level: s.stock_risk,
      current_inventory: s.inventory,
      recommended_reorder_units:
        s.stock_risk === 'critical'
          ? Math.round(s.daily_velocity * 30)
          : Math.round(s.daily_velocity * 14),
      reorder_rationale:
        s.stock_risk === 'critical'
          ? `Only ${s.weeks_of_supply}w supply remaining — reorder immediately`
          : `Supply dropping below 3-week threshold — plan reorder within 7 days`,
      suggested_transfer_from: s.stock_risk === 'critical' ? 'DC-West' : null,
    }));
}

function buildAnalyticsPayload(req, sku = 'navy-blazer-slim', days = 60) {
  const trend = generateSalesTrend(sku, days);
  const stores = generateStoreData();
  const reorders = generateReorderActions(stores);

  const totalUnits = trend.reduce((a, b) => a + b.units, 0);
  const avgDaily = +(totalUnits / days).toFixed(1);
  const peakDay = trend.reduce((a, b) => (b.units > a.units ? b : a));

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const dashboardUrl = `${baseUrl}/dashboard?sku=${encodeURIComponent(sku)}&days=${encodeURIComponent(days)}`;

  return {
    sku,
    period_days: days,
    summary: {
      total_units_sold: totalUnits,
      avg_daily_units: avgDaily,
      peak_day: peakDay.date,
      peak_day_units: peakDay.units,
      total_stores_analyzed: stores.length,
      stores_at_risk: stores.filter((s) => s.stock_risk !== 'healthy').length,
    },
    sales_trend: trend,
    store_performance: stores,
    reorder_actions: reorders,
    dashboard_url: dashboardUrl,
    generated_at: new Date().toISOString(),
  };
}

// ── MCP Discovery ────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    name: 'retailnext-analytics',
    version: '1.1.0',
    description: 'RetailNext merchandising analytics MCP server',
    tools: [
      {
        name: 'get_product_performance',
        description:
          'Returns 60-day unit sales trend, store-level sell-through, stock risk, reorder recommendations, and a hosted dashboard URL for a SKU.',
        inputSchema: {
          type: 'object',
          properties: {
            sku: { type: 'string', description: 'Product SKU or name (e.g. "navy-blazer-slim")' },
            days: { type: 'number', description: 'Lookback window in days (default 60)' },
          },
          required: ['sku'],
        },
      },
    ],
  });
});

// ── Tool Endpoint ────────────────────────────────────────────────────────────

app.post('/tools/get_product_performance', (req, res) => {
  const { sku = 'navy-blazer-slim', days = 60 } = req.body?.params || req.body || {};
  const payload = buildAnalyticsPayload(req, sku, Number(days) || 60);
  res.json(payload);
});

// ── Hosted Dashboard ─────────────────────────────────────────────────────────

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Optional: expose dashboard data separately so dashboard.html can fetch it
app.get('/dashboard-data', (req, res) => {
  const sku = req.query.sku || 'navy-blazer-slim';
  const days = Number(req.query.days) || 60;
  const payload = buildAnalyticsPayload(req, sku, days);
  res.json(payload);
});

// ── Health Check ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`RetailNext MCP server running on port ${PORT}`);
});
