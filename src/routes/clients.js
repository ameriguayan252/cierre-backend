const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const crypto = require('crypto');

// Generate portal token for a client
router.post('/:id/portal-token', async (req, res) => {
  try {
    const token = crypto.randomBytes(16).toString('hex');
    
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', req.params.id)
      .single();
    
    if (!client) return res.status(404).json({ error: 'Client not found' });
    
    const clientData = client.data || client;
    clientData.portal_token = token;
    
    await supabase
      .from('clients')
      .update({ data: clientData })
      .eq('id', req.params.id);
    
    const portalUrl = `${process.env.FRONTEND_URL}/portal/${token}`;
    res.json({ ok: true, token, portalUrl });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Update client search criteria
router.patch('/:id/criteria', async (req, res) => {
  try {
    const { budget, min_beds, preferred_neighborhoods, property_types } = req.body;
    
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', req.params.id)
      .single();
    
    if (!client) return res.status(404).json({ error: 'Client not found' });
    
    const clientData = client.data || client;
    if (budget) clientData.budget = budget;
    if (min_beds) clientData.min_beds = min_beds;
    if (preferred_neighborhoods) clientData.preferred_neighborhoods = preferred_neighborhoods;
    if (property_types) clientData.property_types = property_types;
    
    await supabase
      .from('clients')
      .update({ data: clientData })
      .eq('id', req.params.id);
    
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
