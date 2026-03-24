const { extractPropertyWithClaude } = require('./extractor');
const { saveProperty, isDuplicate, matchPropertyToClients } = require('./propertyDb');
const supabase = require('../supabase');

async function processGmailWebhook(body) {
  console.log('[Gmail] Processing forwarded message...');

  const text = body.text || body.body || body.content || '';
  const subject = body.subject || '';
  const attachments = body.attachments || [];

  if (!text && !subject) return { ok: false, reason: 'no content' };

  const fullText = `${subject}\n${text}`;
  const extracted = await extractPropertyWithClaude(fullText, null);

  if (!extracted || !extracted.title) {
    await supabase.from('raw_intake').insert({
      id: 'raw_' + Date.now(),
      source: 'gmail_whatsapp',
      raw_text: fullText.slice(0, 5000),
      received_at: new Date().toISOString(),
      processed: false
    });
    return { ok: false, reason: 'saved to raw intake for manual review' };
  }

  if (attachments.length > 0) {
    extracted.photos = attachments
      .filter(a => a.contentType && a.contentType.startsWith('image/'))
      .map(a => a.url || a.content_url || null)
      .filter(Boolean);
  }

  const dup = await isDuplicate(null, extracted.title, extracted.price);
  if (dup) return { ok: false, reason: 'duplicate' };

  const property = await saveProperty(extracted, 'whatsapp_forward', null);
  const matches = await matchPropertyToClients(property);

  console.log(`[Gmail] Saved: ${property.title} | Matches: ${matches.length}`);
  return { ok: true, property, matches };
}

module.exports = { processGmailWebhook };
