const express = require('express');
const router = express.Router();
const supabase = require('../supabase');

router.get('/:token', async (req, res) => {
  try {
    const { data: clients } = await supabase.from('clients').select('*');
    const client = clients?.find(c => (c.data || c).portal_token === req.params.token);
    if (!client) return res.status(404).json({ error: 'Portal not found' });

    const clientData = client.data || client;
    const { data: matches } = await supabase
      .from('property_clients')
      .select('property_id, client_interested, showing_requested')
      .eq('client_id', clientData.id);

    const propertyIds = matches?.map(m => m.property_id) || [];
    if (!propertyIds.length) {
      return res.json({ client: { name: clientData.name }, properties: [] });
    }

    const { data: properties } = await supabase
      .from('properties')
      .select('id, title, property_type, price, currency, bedrooms, bathrooms, parking, sqm, neighborhood, city, description, amenities, status, delivery_date, payment_plan, developer, photos, date_added')
      .in('id', propertyIds)
      .eq('client_visible', true);

    const safeProperties = (properties || []).map(p => {
      const match = matches.find(m => m.property_id === p.id);
      const added = new Date(p.date_added);
      const isNew = (new Date() - added) / (1000 * 60 * 60 * 24) <= 3;
      return {
        ...p,
        is_interested: match?.client_interested || false,
        showing_requested: match?.showing_requested || false,
        is_new: isNew
      };
    });

    res.json({ client: { name: clientData.name, budget: clientData.budget }, properties: safeProperties });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:token/interested', async (req, res) => {
  try {
    const { propertyId } = req.body;
    const { data: clients } = await supabase.from('clients').select('*');
    const client = clients?.find(c => (c.data || c).portal_token === req.params.token);
    if (!client) return res.status(404).json({ error: 'Not found' });
    const clientData = client.data || client;

    await supabase.from('property_clients')
      .update({ client_interested: true, interested_at: new Date().toISOString() })
      .eq('property_id', propertyId)
      .eq('client_id', clientData.id);

    const { data: property } = await supabase.from('properties')
      .select('title, price, neighborhood').eq('id', propertyId).single();

    console.log(`[Portal] ${clientData.name} interested in ${property?.title}`);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:token/showing', async (req, res) => {
  try {
    const { propertyId, preferredDate } = req.body;
    const { data: clients } = await supabase.from('clients').select('*');
    const client = clients?.find(c => (c.data || c).portal_token === req.params.token);
    if (!client) return res.status(404).json({ error: 'Not found' });
    const clientData = client.data || client;

    await supabase.from('property_clients')
      .update({ showing_requested: true, preferred_showing_date: preferredDate, showing_requested_at: new Date().toISOString() })
      .eq('property_id', propertyId)
      .eq('client_id', clientData.id);

    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
