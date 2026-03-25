const fetch = require('node-fetch');

async function extractPropertyWithClaude(rawText, sourceUrl) {
  const prompt = `You are a real estate data extraction specialist for Paraguay.

Extract all property details from this listing text and return ONLY valid JSON.

Text to extract from:
${rawText.slice(0, 3000)}

Source URL: ${sourceUrl || 'unknown'}

Return this exact JSON structure (use null for missing fields):
{
  "title": "property name or address",
  "property_type": "apartment|house|land|commercial|penthouse|studio|office",
  "price": 150000,
  "currency": "USD",
  "bedrooms": 2,
  "bathrooms": 2,
  "parking": 1,
  "sqm": 85,
  "lot_size": null,
  "neighborhood": "Villa Morra",
  "city": "Asunción",
  "address": "full address if available",
  "description": "full property description",
  "amenities": ["pool", "gym", "parking"],
  "status": "available|off_plan|in_construction|finished",
  "delivery_date": "Q1 2026 or null",
  "payment_plan": "description of payment plan or null",
  "developer": "developer name or null",
  "listing_agent_name": "agent name or null",
  "listing_agent_phone": "agent phone/whatsapp or null",
  "photos": ["url1", "url2"],
  "floor_plan_url": null
}

IMPORTANT: 
- Return ONLY the JSON object, no other text
- For Paraguay properties, currency is usually USD
- Extract all photo URLs you can find
- Status: off_plan = pre-construction, in_construction = being built, finished = ready now
- If neighborhood not clear, use city name`;

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
    
    // Clean and parse JSON
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(clean);
  } catch(e) {
    console.error('Claude extraction failed:', e.message);
    return null;
  }
}

module.exports = { extractPropertyWithClaude };
