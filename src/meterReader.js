// Reads a pump's totalizer index from a photo with Claude's vision, through the Messages API over
// Node's fetch (no dependency, like the mails). ANTHROPIC_API_KEY is set on Render; without it the
// photo button is not offered. Claude Sonnet 5.5 reads digits far better than Haiku, which misread
// the station's meters (`METER_MODEL` to change it); the attendant checks the figure before saving.
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.METER_MODEL || 'claude-sonnet-5-5';
const TIMEOUT_MS = 25000; // under the 30 s the phone waits for this request
// Litres a meter can plausibly run between two readings (several days of sales, a missed reading).
const MAX_STEP = 100000;

const SCHEMA = {
  type: 'object',
  properties: {
    readable: { type: 'boolean' },
    digits: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    index: { anyOf: [{ type: 'number' }, { type: 'null' }] },
  },
  required: ['readable', 'digits', 'index'],
  additionalProperties: false,
};

const enabled = () => !!process.env.ANTHROPIC_API_KEY;

function prompt({ product, last }) {
  return [
    `Photo du compteur d’une pompe à carburant${product ? ` (${product})` : ''} dans une station-service à Goma.`,
    'Lis l’index TOTALISATEUR EN LITRES : le compteur cumulatif des litres depuis la mise en service.',
    '- Mécanique : une rangée de rouleaux chiffrés (souvent 6 à 9), parfois avec une fenêtre « L » ou « LITRES ». Les derniers rouleaux, souvent d’une autre couleur (rouge, blanc), sont les décimales. Un rouleau arrêté entre deux chiffres compte pour le plus petit des deux.',
    '- Électronique : l’affichage TOTAL / TOTALIZER du volume (L), pas celui du montant ($, FC, AMOUNT).',
    '- Ne lis jamais l’affichage de la vente en cours (montant, litres servis, prix au litre), ni un numéro de série ou de pompe.',
    'Lis chiffre par chiffre, de gauche à droite, sans en sauter ni en ajouter. Dans « digits », recopie exactement les chiffres vus, avec une virgule avant les décimales s’il y en a. Dans « index », le même nombre (point décimal, sans séparateur de milliers).',
    last != null
      ? `Le dernier index relevé sur ce compteur était ${last} : l’index de la photo est égal ou plus grand, généralement de quelques centaines à quelques milliers de litres. Sers-t’en pour reconnaître le bon compteur et placer la virgule, mais recopie les chiffres visibles, ne les invente pas.`
      : null,
    'Si l’index n’est pas lisible avec certitude (flou, coupé, reflet, pas de totalisateur visible), réponds readable: false, digits: null, index: null.',
  ]
    .filter(Boolean)
    .join('\n');
}

// A misplaced decimal point is the usual slip: the reading that fits after the last index wins.
// Returns { index, suspect } — suspect when no reading fits, for the attendant to look twice.
function checkAgainst(index, last) {
  if (last == null) return { index, suspect: false };
  const fits = (v) => v >= last - 0.01 && v <= last + MAX_STEP;
  if (fits(index)) return { index, suspect: false };
  const shifted = [index / 10, index / 100, index / 1000, index * 10, index * 100]
    .map((v) => Math.round(v * 100) / 100)
    .filter(fits)
    .sort((a, b) => a - b)[0];
  return shifted != null ? { index: shifted, suspect: false } : { index, suspect: true };
}

// image: JPEG or PNG as base64 (without the data: prefix). Returns { index, suspect }, or null when unreadable.
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
        // A declined request is run again on another model inside the same call.
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
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
    if (message.stop_reason !== 'end_turn') {
      console.warn('Lecture du compteur : arrêt', message.stop_reason);
      return null;
    }
    const text = message.content.find((b) => b.type === 'text')?.text;
    const out = JSON.parse(text || '{}');
    // In the server log, to see what the meters look like to the model.
    console.log(`Lecture du compteur ${product || ''} : ${JSON.stringify(out)} (dernier ${last ?? '—'})`);
    if (!out.readable || !Number.isFinite(out.index) || out.index < 0) return null;
    return checkAgainst(out.index, last);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { readMeter, meterReaderEnabled: enabled, checkAgainst };
