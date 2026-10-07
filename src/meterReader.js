// Reads a pump's totalizer index from a photo with Claude's vision, through the Messages API over
// Node's fetch (no dependency, like the mails). ANTHROPIC_API_KEY is set on Render; without it the
// photo button is not offered. The fastest model is used (`METER_MODEL` to change it): the reading
// comes back in about two seconds and the attendant checks it before saving.
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.METER_MODEL || 'claude-haiku-4-5';
const TIMEOUT_MS = 12000; // under the app’s own 15 s

const SCHEMA = {
  type: 'object',
  properties: {
    readable: { type: 'boolean' },
    index: { anyOf: [{ type: 'number' }, { type: 'null' }] },
  },
  required: ['readable', 'index'],
  additionalProperties: false,
};

const enabled = () => !!process.env.ANTHROPIC_API_KEY;

function prompt({ product, last }) {
  return [
    `Photo du compteur d’une pompe à carburant${product ? ` (${product})` : ''} dans une station-service.`,
    'Lis l’index totalisateur : le compteur cumulatif des litres depuis la mise en service (mécanique à rouleaux ou électronique, souvent marqué TOTAL ou TOTALISATEUR).',
    'Ne lis pas l’affichage de la vente en cours (montant, litres servis, prix au litre).',
    last != null ? `Le dernier index relevé était ${last} : l’index lu est normalement égal ou un peu plus grand. Recopie seulement les chiffres visibles, sans les deviner à partir de ce nombre.` : null,
    'Garde les décimales si le compteur en montre (séparées par une virgule, un point ou des rouleaux d’une autre couleur), sans séparateur de milliers.',
    'Si l’index n’est pas lisible avec certitude (flou, coupé, reflet, pas de compteur), réponds readable: false et index: null.',
  ]
    .filter(Boolean)
    .join('\n');
}

// image: JPEG or PNG as base64 (without the data: prefix). Returns the index, or null when unreadable.
async function readMeter({ image, mediaType = 'image/jpeg', product, last }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 256,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
              { type: 'text', text: prompt({ product, last }) },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`API ${res.status}: ${body.slice(0, 300)}`);
    }
    const message = await res.json();
    if (message.stop_reason !== 'end_turn') return null;
    const text = message.content.find((b) => b.type === 'text')?.text;
    const out = JSON.parse(text || '{}');
    return out.readable && Number.isFinite(out.index) && out.index >= 0 ? out.index : null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { readMeter, meterReaderEnabled: enabled };
