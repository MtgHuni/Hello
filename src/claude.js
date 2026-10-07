// Claude through the Messages API over Node's fetch (no dependency, like the mails). ANTHROPIC_API_KEY
// on Render turns on what uses it: the meter, notebook and plate photos, the reports' commentary.
// Without it those are simply not offered (tests and development call nothing).
const { fail } = require('./util');

const API_URL = 'https://api.anthropic.com/v1/messages';

const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;

// A photo sent by the app: base64 without the data: prefix, JPEG, PNG or WebP.
function imageParam(body) {
  const data = String(body?.image || '');
  if (data.length < 100 || !/^[A-Za-z0-9+/=]+$/.test(data)) fail(400, 'Photo illisible.');
  const mediaType = ['image/jpeg', 'image/png', 'image/webp'].includes(body?.mediaType) ? body.mediaType : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
}

// One question, one answer: with a JSON schema the answer is the parsed object (structured output),
// without one the text. Null when the model did not finish (refusal, length).
async function ask({ model, effort = 'low', content, schema, maxTokens = 4000, timeoutMs = 25000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        // A declined request is run again on another model inside the same call.
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        fallbacks: 'default',
        output_config: { effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
        messages: [{ role: 'user', content }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`API ${res.status}: ${body.slice(0, 300)}`);
    }
    const message = await res.json();
    if (message.stop_reason !== 'end_turn') {
      console.warn('Claude : arrêt', message.stop_reason);
      return null;
    }
    const text = message.content.find((b) => b.type === 'text')?.text || '';
    return schema ? JSON.parse(text || '{}') : text.trim();
  } finally {
    clearTimeout(timer);
  }
}

// What the routes reply when the call itself failed (key, credit, network, delay).
async function askOr422(args, label) {
  try {
    return await module.exports.ask(args); // through the exports, so the tests can stand in for Claude
  } catch (err) {
    console.error(`${label} :`, err.message);
    fail(422, 'Lecture impossible : réessayez ou tapez-le.', 'reader_failed');
  }
}

module.exports = { aiEnabled, imageParam, ask, askOr422 };
