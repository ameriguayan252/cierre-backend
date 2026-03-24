const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const { extractPropertyWithClaude } = require('../services/extractor');
const { saveProperty, isDuplicate, matchPropertyToClients } = require('../services/propertyDb');
const { searchForClient } = require('../services/scraper');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

// Get all properties
router.get('/', async (req, res) => {
  try {
    let query = supabase.from('properties').select('*').order('date_added', { ascending: false });
    if (req.query.status) query = query.eq('status', req.query.status);
    if (req.query.neighborhood) query = query.ilike('neighborhood', `%${req.query.neighborhood}%`);
    if (req.query.min_price) query = query.gte('price', req.query.min_price);
    if (req.query.max_price) query = query.lte('price', req.query.max_price);
    if (req.query.bedrooms) query = query.gte('bedrooms', req.query.bedrooms);
    if (req.query.needs_review) query = query.eq('needs_review', req.query.needs_review === 'true');
    if (req.query.client_visible) query = query.eq('client_visible', req.query.client_visible === 'true');
    const { data, error } = await query.limit(200);
    if (error) throw error;
    res.json(data || []);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Extract from URL
router.post('/extract-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    const pageRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000
    });
    const html = await pageRes.text();
    const $ = cheerio.load(html);
    $('script, style, nav, footer').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 4000);
    const images = [];
    $('img').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && src.includes('http') && !src.includes('logo')) images.push(src);
    });
    const extracted = await extractPropertyWithClaude(text, url);
    if (extracted && images.length > 0) {
      extracted.photos = [...(extracted.photos || []), ...images].slice(0, 20);
    }
    res.json({ extracted, url });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Save property
router.post('/', async (req, res) => {
  try {
    const { extracted, source, sourceUrl } = req.body;
    const dup = await isDuplicate(sourceUrl, extracted.title, extracted.price);
    if (dup) return res.json({ ok: false, reason: 'duplicate' });
    const property = await saveProperty(extracted, source || 'manual', sourceUrl);
    const matches = await matchPropertyToClients(property);
    res.json({ ok: true, property, matches: matches.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Update property
router.patch('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('properties')
      .update({ ...req.body, last_checked: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete property
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('properties').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// AI search for client
router.post('/search/ai', async (req, res) => {
  try {
    const { criteria } = req.body;
    const properties = await searchForClient(criteria);
    res.json({ ok: true, properties, count: properties.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Stats
router.get('/stats/summary', async (req, res) => {
  try {
    const { data } = await supabase.from('properties').select('status, source, needs_review');
    const stats = {
      total: data?.length || 0,
      available: data?.filter(p => p.status === 'available').length || 0,
      off_plan: data?.filter(p => p.status === 'off_plan').length || 0,
      in_construction: data?.filter(p => p.status === 'in_construction').length || 0,
      needs_review: data?.filter(p => p.needs_review).length || 0
    };
    res.json(stats);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
