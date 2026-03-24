const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { extractPropertyWithClaude } = require('./extractor');
const { saveProperty, isDuplicate, matchPropertyToClients } = require('./propertyDb');

async function searchWithSerper(query) {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ q: query, num: 10, gl: 'py', hl: 'es' })
  });
  const data = await res.json();
  return data.organic || [];
}

async function fetchPageText(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 10000
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, nav, footer').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    const images = [];
    $('img').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && src.includes('http') && !src.includes('logo')) images.push(src);
    });
    return { text: text.slice(0, 4000), images: images.slice(0, 20) };
  } catch(e) {
    return null;
  }
}

async function processListing(listing) {
  const { url, snippet, source } = listing;
  if (!url) return null;

  const dup = await isDuplicate(url, listing.title, null);
  if (dup) return 'skipped';

  const page = await fetchPageText(url);
  const textToExtract = page
    ? `${listing.title}\n${snippet}\n${page.text}`
    : `${listing.title}\n${snippet}`;

  const extracted = await extractPropertyWithClaude(textToExtract, url);
  if (!extracted || !extracted.title) return null;

  if (page && page.images.length > 0) {
    extracted.photos = [...(extracted.photos || []), ...page.images].slice(0, 20);
  }

  const property = await saveProperty(extracted, source, url);
  const matches = await matchPropertyToClients(property);
  console.log(`[Scraper] Saved: ${property.title} | Matches: ${matches.length}`);
  return { property, matches };
}

async function scrapeAll() {
  const queries = [
    'site:infocasas.com.py departamento en venta Asuncion',
    'site:infocasas.com.py casa en venta Paraguay',
    'site:remax.com.py propiedades en venta Asuncion',
    'site:century21.com.py propiedades en venta',
    'omnimls.com.py propiedades Paraguay venta'
  ];

  const allListings = [];
  for (const query of queries) {
    try {
      const results = await searchWithSerper(query);
      allListings.push(...results.map(l => ({
        url: l.link,
        title: l.title,
        snippet: l.snippet,
        source: query.includes('infocasas') ? 'infocasas' :
                query.includes('remax') ? 'remax' :
                query.includes('century21') ? 'century21' : 'omnimls'
      })));
    } catch(e) {
      console.error('Search failed:', e.message);
    }
  }

  let added = 0, skipped = 0;
  for (const listing of allListings) {
    try {
      const result = await processListing(listing);
      if (result === 'skipped') skipped++;
      else if (result) added++;
      await new Promise(r => setTimeout(r, 1500));
    } catch(e) {
      console.error('Process failed:', e.message);
    }
  }

  return { added, skipped };
}

async function searchForClient(criteria) {
  const { neighborhood, minBeds, maxPrice, propertyType } = criteria;
  const query = [
    propertyType || 'departamento',
    'en venta',
    neighborhood || 'Asuncion Paraguay',
    maxPrice ? `precio ${maxPrice}` : '',
    minBeds ? `${minBeds} dormitorios` : ''
  ].filter(Boolean).join(' ');

  const results = await searchWithSerper(query);
  const processed = [];
  for (const listing of results.slice(0, 5)) {
    const result = await processListing({
      url: listing.link,
      title: listing.title,
      snippet: listing.snippet,
      source: 'ai_search'
    });
    if (result && result !== 'skipped') processed.push(result.property);
    await new Promise(r => setTimeout(r, 1000));
  }
  return processed;
}

module.exports = { scrapeAll, searchForClient };
