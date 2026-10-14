// A few lines at the top of the week's and the month's report mail, written by Claude from the
// period's figures, the previous period's and the alerts open now: what the manager and the owner
// should notice. Only when ANTHROPIC_API_KEY is set; the report goes without it on any failure.
const claude = require('./claude');

const MODEL = process.env.REPORT_MODEL || 'claude-opus-5-5';

const SCHEMA = {
  type: 'object',
  properties: {
    points: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, level: { type: 'string', enum: ['bad', 'good', 'info'] } },
        required: ['text', 'level'],
        additionalProperties: false,
      },
    },
  },
  required: ['points'],
  additionalProperties: false,
};

// The figures without the cash book's movements (long, and in the PDF anyway).
const figures = ({ cashbook, ...report }) => report;

async function periodComment({ label, report, previous, alerts = [], stationName }) {
  const text = [
    `Tu analyses le rapport ${label} de la station-service ${stationName || ''} à Goma (RD Congo), qui vend du gasoil et de l’essence. Montants en dollars US.`,
    'Le gérant et l’actionnaire liront tes constats en tête du mail du rapport. Écris 3 à 5 constats, une phrase courte chacun, en français, chiffres à l’appui (format français : 1 234,50 $), les plus utiles en premier :',
    '- évolution des ventes et des litres par rapport à la période précédente, par produit ;',
    '- écarts de caisse : par pompiste, répétés, montants ;',
    '- crédits accordés face aux règlements reçus (l’encours qui monte ou baisse) ;',
    '- dépenses inhabituelles, marge, livraisons et pertes de cuve s’il y en a ;',
    '- alertes encore ouvertes qui demandent une action.',
    'Interprète, ne recopie pas les chiffres bruts. Pas de salutation, pas de conclusion. level : « bad » pour un problème à traiter, « good » pour une bonne nouvelle, « info » sinon. Si une donnée manque, n’en parle pas.',
    `\nPériode (${report.from} au ${report.to}) :\n${JSON.stringify(figures(report))}`,
    previous ? `\nPériode précédente (${previous.from} au ${previous.to}) :\n${JSON.stringify(figures(previous))}` : '',
    alerts.length ? `\nAlertes ouvertes maintenant :\n- ${alerts.join('\n- ')}` : '',
  ].join('\n');
  const out = await claude.ask({ model: MODEL, effort: 'medium', schema: SCHEMA, maxTokens: 16000, timeoutMs: 120000, content: [{ type: 'text', text }] });
  const points = (out?.points || []).filter((p) => p.text?.trim()).slice(0, 5);
  return points.length ? points : null;
}

module.exports = { periodComment };
