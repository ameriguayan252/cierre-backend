const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { extractPropertyWithClaude } = require('./extractor');
const { saveProperty, isDuplicate, matchPropertyToClients } = require('./propertyDb');

// Serper search to find new listings
async function searchWithSerper(query) {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      q: query,
      num: 10,
      gl: 'py', // Paraguay
      hl: 'es'
    })
  });
  const data = await res.json();
  return data.organic || [];
}

// Fetch and parse a property listing page
async function fetchPageText(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    
    // Remove scripts, styles, nav, footer
    $('script, style, nav, footer, header, .cookie, .modal').remove();
    
    // Get all text and image URLs
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    const images = [];
    $('img').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && (src.includes('http') || src.startsWith('/'))) {
        const fullUrl = src.startsWith('/') ? new URL(src, url).href : src;
        if (!fullUrl.includes('logo') && !fullUrl.includes('icon') && !fullUrl.includes('banner')) {
          images.push(fullUrl);
        }
      }
    });
    
    return { text: text.slice(0, 4000), images: images.slice(0, 20) };
  } catch(e) {
    console.warn(`Failed to fetch ${url}:`, e.message);
    return null;
  }
}

// Scrape InfoCasas
async function scrapeInfoCasas() {
  console.log('[Scraper] Searching InfoCasas...');
  const queries = [
    'site:infocasas.com.py departamento en venta Asuncion',
    'site:infocasas.com.py casa en venta Paraguay',
    'site:infocasas.com.py apartamento venta Villa Morra'
  ];
  
  const results = [];
  for (const query of queries) {
    const listings = await searchWithSerper(query);
    results.push(...listings.map(l => ({ url: l.link, title: l.title, snippet: l.snippet, source: 'infocasas' })));
  }
  return results;
}

// Scrape Remax Paraguay
async function scrapeRemax() {
  console.log('[Scraper] Searching Remax Paraguay...');
  const queries = [
    'site:remax.com.py propiedades en venta Asuncion',
    'site:remax.com.py departamento venta Paraguay'
  ];
  
  const results = [];
  for (const query of queries) {
    const listings = await searchWithSerper(query);
    results.push(...listings.map(l => ({ url: l.link, title: l.title, snippet: l.snippet, source: 'remax' })));
  }
  return results;
}

// Scrape Century 21 Paraguay
async function scrapeCentury21() {
  console.log('[Scraper] Searching Century 21 Paraguay...');
  const queries = [
    'site:century21.com.py propiedades en venta',
    'site:century21paraguay.com venta departamento'
  ];
  
  const results = [];
  for (const query of queries) {
    const listings = await searchWithSerper(query);
    results.push(...listings.map(l => ({ url: l.link, title: l.title, snippet: l.snippet, source: 'century21' })));
  }
  return results;
}

// Scrape OmniMLS
async function scrapeOmniMLS() {
  console.log('[Scraper] Searching OmniMLS...');
  const queries = [
    'site:omnimls.com.py propiedades Paraguay venta',
    'omnimls Paraguay departamento en venta Asuncion'
  ];
  
  const results = [];
  for (const query of queries) {
    const listings = await searchWithSerper(query);
    results.push(...listings.map(l => ({ url: l.link, title: l.title, snippet: l.snippet, source: 'omnimls' })));
  }
  return results;
}

// Process a single listing URL
async function processListing(listing) {
  const { url, snippet, source } = listing;
  
  if (!url) return null;
  
  // Check duplicate first (fast, no API call)
  const dup = await isDuplicate(url, listing.title, null);
  if (dup) {
    console.log(`[Scraper] Skipping duplicate: ${url}`);
    return 'skipped';
  }
  
  // Fetch page content
  const page = await fetchPageText(url);
  const textToExtract = page 
    ? `${listing.title}\n${snippet}\n${page.text}`
    : `${listing.title}\n${snippet}`;
  
  // Extract with Claude
  const extracted = await extractPropertyWithClaude(textToExtract, url);
  if (!extracted || !extracted.title) return null;
  
  // Add images from page
  if (page && page.images.length > 0) {
    extracted.photos = [...(extracted.photos || []), ...page.images].slice(0, 20);
  }
  
  // Save to database
  const property = await saveProperty(extracted, source, url);
  
  // Match to clients
  const matches = await matchPropertyToClients(property);
  console.log(`[Scraper] Saved: ${property.title} | Matches: ${matches.length} clients`);
  
  return { property, matches };
}

// Run all scrapers
async function scrapeAll() {
  console.log('[Scraper] Starting full scrape...');
  
  const allListings = [];
  
  try { allListings.push(...await scrapeInfoCasas()); } catch(e) { console.error('InfoCasas failed:', e.message); }
  try { allListings.push(...await scrapeRemax()); } catch(e) { console.error('Remax failed:', e.message); }
  try { allListings.push(...await scrapeCentury21()); } catch(e) { console.error('Century21 failed:', e.message); }
  try { allListings.push(...await scrapeOmniMLS()); } catch(e) { console.error('OmniMLS failed:', e.message); }
  
  console.log(`[Scraper] Found ${allListings.length} listings to process`);
  
  let added = 0;
  let skipped = 0;
  
  // Process listings with delay to avoid rate limits
  for (const listing of allListings) {
    try {
      const result = await processListing(listing);
      if (result === 'skipped') skipped++;
      else if (result) added++;
      
      // Small delay between requests
      await new Promise(r => setTimeout(r, 1500));
    } catch(e) {
      console.error(`Failed to process ${listing.url}:`, e.message);
    }
  }
  
  console.log(`[Scraper] Complete. Added: ${added}, Skipped: ${skipped}`);
  return { added, skipped };
}

// Search for specific criteria (for AI agent)
async function searchForClient(criteria) {
  const { neighborhood, minBeds, maxPrice, propertyType } = criteria;
  
  const query = [
    propertyType || 'departamento',
    'en venta',
    neighborhood || 'Asuncion Paraguay',
    maxPrice ? `precio ${maxPrice}` : '',
    minBeds ? `${minBeds} dormitorios` : '',
    'infocasas OR remax OR century21'
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
