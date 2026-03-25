const { extractPropertyWithClaude } = require('./extractor');
const { saveProperty, isDuplicate, matchPropertyToClients } = require('./propertyDb');
const supabase = require('../supabase');

async function processGmailWebhook(body) {
  console.log('[Gmail] Processing forwarded message...');
  
  const text = body.text || body.body || body.content || '';
  const subject = body.subject || '';
  const attachments = body.attachments || [];
  
  if (!text && !subject) {
    console.log('[Gmail] No text content found');
    return { ok: false, reason: 'no content' };
  }
  
  const fullText = `${subject}\n${text}`;
  
  // Extract property data with Claude
  const extracted = await extractPropertyWithClaude(fullText, null);
  
  if (!extracted || !extracted.title) {
    console.log('[Gmail] Could not extract property data');
    // Save as raw intake for manual review
    await supabase.from('raw_intake').insert({
      id: 'raw_' + Date.now(),
      source: 'gmail_whatsapp',
      raw_text: fullText.slice(0, 5000),
      received_at: new Date().toISOString(),
      processed: false
    });
    return { ok: false, reason: 'extraction failed - saved to raw intake' };
  }
  
  // Handle photo attachments
  if (attachments.length > 0) {
    // Store attachment URLs/base64 references
    extracted.photos = attachments
      .filter(a => a.contentType && a.contentType.startsWith('image/'))
      .map(a => a.url || a.content_url || null)
      .filter(Boolean);
    
    // If attachments are base64, upload to Supabase Storage
    for (const att of attachments) {
      if (att.data && att.filename) {
        try {
          const buffer = Buffer.from(att.data, 'base64');
          const filename = `whatsapp/${Date.now()}_${att.filename}`;
          const { data: uploadData } = await supabase.storage
            .from('property-photos')
            .upload(filename, buffer, { contentType: att.contentType });
          
          if (uploadData) {
            const { data: urlData } = supabase.storage
              .from('property-photos')
              .getPublicUrl(filename);
            if (urlData?.publicUrl) {
              extracted.photos.push(urlData.publicUrl);
            }
          }
        } catch(e) {
          console.warn('[Gmail] Photo upload failed:', e.message);
        }
      }
    }
  }
  
  // Check duplicate
  const dup = await isDuplicate(null, extracted.title, extracted.price);
  if (dup) {
    console.log('[Gmail] Duplicate property, skipping');
    return { ok: false, reason: 'duplicate' };
  }
  
  // Save property
  const property = await saveProperty(extracted, 'whatsapp_forward', null);
  
  // Match to clients
  const matches = await matchPropertyToClients(property);
  
  console.log(`[Gmail] Saved: ${property.title} | Matches: ${matches.length} clients`);
  
  return { ok: true, property, matches };
}

module.exports = { processGmailWebhook };
