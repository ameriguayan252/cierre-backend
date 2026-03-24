const fetch = require('node-fetch');

async function extractPropertyWithClaude(rawText, sourceUrl) {
  const prompt = `You are a real estate data extraction specialist for Paraguay.

Extract all property details from this listing and return ONLY valid JSON.

Text: ${rawText.slice(0, 3000)}
Source URL: ${sourceUrl || 'unknown'}

Return this exact JSON (use null for missing fields):
{
  "title": "property name or address",
  "property_type": "apartment|house|land|commercial|penthouse|studio",
  "price": 150000,
  "currency": "USD",
  "bedrooms": 2,
  "bathrooms": 2,
  "parking": 1,
  "sqm": 85,
  "neighborhood": "Villa Morra",
  "city": "Asunción",
  "address": null,
  "description": "full description",
  "amenities": ["pool", "gym"],
  "status": "available|off_plan|in_construction|finished",
  "delivery_date": null,
  "payment_plan": null,
  "developer": null,
  "listing_agent_name": null,
  "listing_agent_phone": null,
  "photos": []
}

Return ONLY the JSON, nothing else.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    const text = data.content?.[0]?.text || '{}';
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(clean);
  } catch(e) {
    console.error('Extraction failed:', e.message);
    return null;
  }
}

module.exports = { extractPropertyWithClaude };
