require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());

const { scrapeAll } = require('./services/scraper');
const { processGmailWebhook } = require('./services/gmail');
const propertyRoutes = require('./routes/properties');
const clientRoutes = require('./routes/clients');
const portalRoutes = require('./routes/portal');

// Routes
app.use('/api/properties', propertyRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/portal', portalRoutes);

// Gmail webhook from Make.com
app.post('/webhook/gmail', async (req, res) => {
  try {
    await processGmailWebhook(req.body);
    res.json({ ok: true });
  } catch(e) {
    console.error('Gmail webhook error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Manual scrape trigger
app.post('/api/scrape', async (req, res) => {
  try {
    const results = await scrapeAll();
    res.json({ ok: true, added: results.added, skipped: results.skipped });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Scheduled scraping every 2 hours
cron.schedule('0 */2 * * *', async () => {
  console.log('[CRON] Running scheduled property scrape...');
  try {
    const results = await scrapeAll();
    console.log(`[CRON] Done. Added: ${results.added}, Skipped: ${results.skipped}`);
  } catch(e) {
    console.error('[CRON] Scrape failed:', e.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CIERRE Backend running on port ${PORT}`);
  console.log(`Scheduled scraping every 2 hours`);
});
