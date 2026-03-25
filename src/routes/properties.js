const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const { extractPropertyWithClaude } = require('../services/extractor');
const { saveProperty, isDuplicate, matchPropertyToClients } = require('../services/propertyDb');
const { searchForClient } = require('../services/scraper');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

// GET all properties (internal)
router.get('/', async (req, res) => {
  try {
    let query = supabase
      .from('properties')
      .select('*')
      .order('date_added', { ascending: false });

    // Filters
    if (req.query.status) query = query.eq('status', req.query.status);
    if (req.query.neighborhood) query = query.ilike('neighborhood', `%${req.query.neighborhood}%`);
    if (req.query.min_price) query = query.gte('price', req.query.min_price);
    if (req.query.max_price) query = query.lte('price', req.query.max_price);
    if (req.query.bedrooms) query = query.gte('bedrooms', req.query.bedrooms);
    if (req.query.type) query = query.eq('property_type', req.query.type);
    if (req.query.source) query = query.eq('source', req.query.source);
    if (req.query.needs_review) query = query.eq('needs_review', req.query.needs_review === 'true');
    if (req.query.client_visible) query = query.eq('client_visible', req.query.client_visible === 'true');

    const { data, error } = await query.limit(200);
    if (error) throw error;
    res.json(data || []);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET single property
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch(e) {
    res.status(404).json({ error: 'Property not found' });
  }
});

// POST - extract from URL
router.post('/extract-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    // Fetch page
    const pageRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 15000
    });
    const html = await pageRes.text();
    const $ = cheerio.load(html);
    $('script, style, nav, footer').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 4000);
    
    // Extract images
    const images = [];
    $('img').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && src.includes('http') && !src.includes('logo')) images.push(src);
    });

    // Extract with Claude
    const extracted = await extractPropertyWithClaude(text, url);
    if (extracted && images.length > 0) {
      extracted.photos = [...(extracted.photos || []), ...images].slice(0, 20);
    }

    res.json({ extracted, url });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST - save property from extracted data
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

// PATCH - update property
router.patch('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('properties')
      .update({ ...req.body, last_checked: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE property
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('properties')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST - AI agent search for client
router.post('/search/ai', async (req, res) => {
  try {
    const { criteria, clientId } = req.body;
    const properties = await searchForClient(criteria);
    res.json({ ok: true, properties, count: properties.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET - stats
router.get('/stats/summary', async (req, res) => {
  try {
    const { data } = await supabase.from('properties').select('status, source, price, needs_review');
    const stats = {
      total: data?.length || 0,
      available: data?.filter(p => p.status === 'available').length || 0,
      off_plan: data?.filter(p => p.status === 'off_plan').length || 0,
      in_construction: data?.filter(p => p.status === 'in_construction').length || 0,
      needs_review: data?.filter(p => p.needs_review).length || 0,
      by_source: {}
    };
    data?.forEach(p => {
      stats.by_source[p.source] = (stats.by_source[p.source] || 0) + 1;
    });
    res.json(stats);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
