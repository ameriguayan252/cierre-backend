const supabase = require('../supabase');

// Generate unique ID
function uid() {
  return 'prop_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Check if property already exists (duplicate detection)
async function isDuplicate(sourceUrl, title, price) {
  if (sourceUrl) {
    const { data } = await supabase
      .from('properties')
      .select('id')
      .eq('source_url', sourceUrl)
      .limit(1);
    if (data && data.length > 0) return true;
  }
  
  // Also check by title + price combination
  if (title && price) {
    const { data } = await supabase
      .from('properties')
      .select('id')
      .eq('title', title)
      .eq('price', price)
      .limit(1);
    if (data && data.length > 0) return true;
  }
  
  return false;
}

// Save a new property
async function saveProperty(extracted, source, sourceUrl) {
  const property = {
    id: uid(),
    title: extracted.title || 'Unnamed Property',
    property_type: extracted.property_type || 'apartment',
    source: source,
    source_url: sourceUrl || null,
    listing_agent_name: extracted.listing_agent_name || null,
    listing_agent_phone: extracted.listing_agent_phone || null,
    neighborhood: extracted.neighborhood || null,
    city: extracted.city || 'Asunción',
    address: extracted.address || null,
    bedrooms: extracted.bedrooms || null,
    bathrooms: extracted.bathrooms || null,
    parking: extracted.parking || null,
    sqm: extracted.sqm || null,
    lot_size: extracted.lot_size || null,
    price: extracted.price || null,
    currency: extracted.currency || 'USD',
    amenities: extracted.amenities || [],
    description: extracted.description || null,
    status: extracted.status || 'available',
    delivery_date: extracted.delivery_date || null,
    payment_plan: extracted.payment_plan || null,
    developer: extracted.developer || null,
    photos: extracted.photos || [],
    floor_plan_url: extracted.floor_plan_url || null,
    internal_notes: null,
    client_visible: false, // YOU control when clients see it
    tags: [],
    date_added: new Date().toISOString().split('T')[0],
    last_checked: new Date().toISOString(),
    needs_review: true // flags new properties for your review
  };

  const { error } = await supabase
    .from('properties')
    .insert(property);

  if (error) throw error;
  return property;
}

// Match property to clients based on their criteria
async function matchPropertyToClients(property) {
  // Get all clients with search criteria
  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .neq('status', 'Closed');

  if (!clients || !clients.length) return [];

  const matches = [];

  for (const client of clients) {
    const c = client.data || client;
    
    // Check budget
    if (c.budget && property.price) {
      const budget = parseFloat(c.budget);
      const price = parseFloat(property.price);
      if (price > budget * 1.15) continue; // 15% over budget = skip
    }

    // Check bedrooms
    if (c.min_beds && property.bedrooms) {
      if (property.bedrooms < c.min_beds) continue;
    }

    // Check neighborhood
    if (c.preferred_neighborhoods && c.preferred_neighborhoods.length > 0) {
      const propNeighborhood = (property.neighborhood || '').toLowerCase();
      const match = c.preferred_neighborhoods.some(n => 
        propNeighborhood.includes(n.toLowerCase()) || 
        n.toLowerCase().includes(propNeighborhood)
      );
      if (!match && propNeighborhood) continue;
    }

    matches.push(c.id || client.id);
  }

  // Save matches
  for (const clientId of matches) {
    await supabase
      .from('property_clients')
      .upsert({
        property_id: property.id,
        client_id: clientId,
        matched_at: new Date().toISOString(),
        client_interested: false,
        showing_requested: false
      });
  }

  return matches;
}

module.exports = { saveProperty, isDuplicate, matchPropertyToClients };
