import { api } from '../api.js';
import { h, fmt, pageHeader, table, segmented, setContent } from '../ui.js';
import { icon } from '../icons.js';

const FILTERS = [
  ['', 'Tout'],
  ['annulations', 'Annulations'],
  ['postes', 'Postes'],
  ['prix', 'Prix'],
  ['reglages', 'Réglages'],
  ['equipe', 'Équipe'],
  ['clients', 'Clients'],
  ['caisse', 'Caisse'],
  ['donnees', 'Sauvegardes'],
];

let filter = '';

// Journal: who changed what — accepted or refused cancellations, prices, settings, team, customers.
export async function renderJournal(page, ctx) {
  const rows = await api.get(`/audit${filter ? `?category=${filter}` : ''}`);
  setContent(
    page,
    h('a', { class: 'back no-print', href: '#/reglages' }, icon('back'), 'Réglages'),
    pageHeader('Journal', null),
    h(
      'section',
      { class: 'card flush' },
      h(
        'div',
        { class: 'card-header' },
        segmented(FILTERS, filter, (v) => {
          filter = v;
          renderJournal(page, ctx);
        }),
      ),
      table(
        [
          { label: 'Date', render: (r) => fmt.dateTime(r.created_at) },
          { label: 'Par', render: (r) => r.user_name || '—' },
          { label: 'Changement', render: (r) => r.summary },
          { label: 'Motif', render: (r) => r.reason || '—' },
        ],
        rows,
        { empty: 'Rien dans le journal pour ce filtre.' },
      ),
    ),
  );
}
