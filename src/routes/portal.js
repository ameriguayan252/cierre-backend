const express = require('express');
const router = express.Router();
const supabase = require('../supabase');

// GET client portal data by token
router.get('/:token', async (req, res) => {
  try {
    // Find client by portal token
    const { data: clients } = await supabase
      .from('clients')
      .select('*');
    
    const client = clients?.find(c => {
      const d = c.data || c;
      return d.portal_token === req.params.token;
    });

    if (!client) return res.status(404).json({ error: 'Portal not found' });
    
    const clientData = client.data || client;
    
    // Get matched properties for this client
    const { data: matches } = await supabase
      .from('property_clients')
      .select('property_id, client_interested, showing_requested')
      .eq('client_id', clientData.id);

    const propertyIds = matches?.map(m => m.property_id) || [];
    
    if (!propertyIds.length) {
      return res.json({
        client: {
          name: clientData.name,
          budget: clientData.budget,
          min_beds: clientData.min_beds,
          preferred_neighborhoods: clientData.preferred_neighborhoods
        },
        properties: []
      });
    }

    // Get the actual properties (client-visible only)
    const { data: properties } = await supabase
      .from('properties')
      .select('id, title, property_type, price, currency, bedrooms, bathrooms, parking, sqm, neighborhood, city, description, amenities, status, delivery_date, payment_plan, developer, photos, date_added')
      .in('id', propertyIds)
      .eq('client_visible', true)
      .eq('status', 'available');

    // IMPORTANT: Remove all listing agent info before sending to client
    const safeProperties = (properties || []).map(p => {
      const match = matches.find(m => m.property_id === p.id);
      return {
        ...p,
        // Never expose these to clients:
        listing_agent_name: undefined,
        listing_agent_phone: undefined,
        source: undefined,
        source_url: undefined,
        internal_notes: undefined,
        // Add interaction state
        is_interested: match?.client_interested || false,
        showing_requested: match?.showing_requested || false,
        is_new: isNewListing(p.date_added)
      };
    });

    res.json({
      client: {
        name: clientData.name,
        budget: clientData.budget,
        min_beds: clientData.min_beds,
        preferred_neighborhoods: clientData.preferred_neighborhoods || []
      },
      properties: safeProperties
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST - client marks interest
router.post('/:token/interested', async (req, res) => {
  try {
    const { propertyId } = req.body;
    
    // Find client
    const { data: clients } = await supabase.from('clients').select('*');
    const client = clients?.find(c => (c.data || c).portal_token === req.params.token);
    if (!client) return res.status(404).json({ error: 'Not found' });
    
    const clientData = client.data || client;
    
    // Update interest
    await supabase
      .from('property_clients')
      .update({ client_interested: true, interested_at: new Date().toISOString() })
      .eq('property_id', propertyId)
      .eq('client_id', clientData.id);

    // Get property details for notification
    const { data: property } = await supabase
      .from('properties')
      .select('title, price, neighborhood')
      .eq('id', propertyId)
      .single();

    // Send WhatsApp notification to agent
    await notifyAgent(clientData, property, 'interested');
    
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST - client requests showing
router.post('/:token/showing', async (req, res) => {
  try {
    const { propertyId, preferredDate } = req.body;
    
    const { data: clients } = await supabase.from('clients').select('*');
    const client = clients?.find(c => (c.data || c).portal_token === req.params.token);
    if (!client) return res.status(404).json({ error: 'Not found' });
    
    const clientData = client.data || client;
    
    await supabase
      .from('property_clients')
      .update({ 
        showing_requested: true, 
        preferred_showing_date: preferredDate,
        showing_requested_at: new Date().toISOString()
      })
      .eq('property_id', propertyId)
      .eq('client_id', clientData.id);

    const { data: property } = await supabase
      .from('properties')
      .select('title, price, neighborhood')
      .eq('id', propertyId)
      .single();

    await notifyAgent(clientData, property, 'showing', preferredDate);
    
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

function isNewListing(dateAdded) {
  if (!dateAdded) return false;
  const added = new Date(dateAdded);
  const now = new Date();
  const diffDays = (now - added) / (1000 * 60 * 60 * 24);
  return diffDays <= 3;
}

async function notifyAgent(client, property, type, date) {
  const agentPhone = process.env.AGENT_WHATSAPP;
  if (!agentPhone) return;
  
  let message = '';
  if (type === 'interested') {
    message = `🏠 *${client.name}* is interested in *${property?.title}* - $${property?.price?.toLocaleString()} in ${property?.neighborhood}. Open CIERRE to follow up.`;
  } else if (type === 'showing') {
    message = `📅 *${client.name}* requested a showing for *${property?.title}*${date ? ' on ' + date : ''}. Open CIERRE to confirm.`;
  }
  
  const waUrl = `https://api.whatsapp.com/send?phone=${agentPhone.replace(/[^0-9]/g,'')}&text=${encodeURIComponent(message)}`;
  console.log('[Notify] Agent notification:', message);
  // In production this would use WhatsApp Business API
  // For now logs the message and URL
}

module.exports = router;
