import { api } from '../api.js';
import { h, fmt, pageHeader, card, cardHeader, button, toast, field, productColor, varianceCell, setContent, confirmDialog } from '../ui.js';
import { renderAttendant } from './attendant.js';
import { withMeterPhoto, meterPhotoLink } from '../photo.js';

// One shift runs from one 15:30 closing to the next, across the night. Inside it, checkpoints:
// a relief (the attendant hands over, money to the next one), the evening closing (19:00, the
// shift stays open) and the morning opening (6:30). Each comes with a mini report of the period.

const KIND = {
  releve: {
    title: 'Relève',
    money: 'Espèces remises au pompiste suivant ($)',
    submit: 'Passer le relais',
    done: 'Relais passé',
  },
  fermeture: {
    title: 'Fermeture du soir',
    money: 'Espèces en caisse à la fermeture ($)',
    submit: 'Fermer la station',
    done: 'Station fermée',
  },
  ouverture: {
    title: 'Ouverture du matin',
    money: 'Espèces reprises de la fermeture ($)',
    submit: 'Ouvrir la station',
    done: 'Station ouverte',
  },
};

const line = (label, value, cls = '') => h('div', { class: `summary-line ${cls}` }, h('span', {}, label), h('span', { class: 'num' }, value));

// The mini report of one period: litres per nozzle, sales from the indexes, what was entered,
// the money the attendant should have, and (once handed over) the gap.
export function reportCard(r, tol, { title, preview = false } = {}) {
  return h(
    'section',
    { class: 'card' },
    cardHeader(title || `${r.label}${r.by ? ` · ${r.by}` : ''}`, `Du ${fmt.dateTime(r.from_at)} au ${fmt.dateTime(r.at)}`),
    r.nozzles.map((n) =>
      h(
        'div',
        { class: 'summary-line' },
        h('span', {}, h('span', { class: 'swatch', style: `background:${productColor(n.product_id)}` }), n.name, h('div', { class: 'muted small' }, `Index ${fmt.number(n.from)} → ${fmt.number(n.to)}`, meterPhotoLink(n.photo_id))),
        h('span', { class: 'num nowrap' }, fmt.liters(n.liters)),
      ),
    ),
    line('Ventes selon les index', fmt.money(r.sold), 'total'),
    r.credits ? line('Vendu à crédit', `− ${fmt.money(r.credits)}`) : null,
    r.combos ? line('Échangé contre des combos', `− ${fmt.money(r.combos)}`) : null,
    r.payments ? line('Règlements reçus', `+ ${fmt.money(r.payments)}`) : null,
    r.expenses ? line('Dépenses payées', `− ${fmt.money(r.expenses)}`) : null,
    r.received ? line(r.from_kind === 'opening' ? 'Monnaie reçue à la clôture' : 'Espèces reçues au début', `+ ${fmt.money(r.received)}`) : null,
    line('Argent à avoir', fmt.money(r.expected), 'total'),
    r.mobile_money ? line('Reçu en mobile money', `− ${fmt.money(r.mobile_money)}`) : null,
    r.mobile_money ? line('Espèces à avoir', fmt.money(r.expected_cash), 'total') : null,
    preview ? null : line('Espèces remises', fmt.money(r.cash)),
    preview ? null : h('div', { class: 'summary-line' }, h('span', {}, 'Écart'), varianceCell(r.variance, tol)),
    r.operations.length
      ? h(
          'details',
          { class: 'report-ops' },
          h('summary', {}, `${r.operations.length} opération${r.operations.length > 1 ? 's' : ''} saisie${r.operations.length > 1 ? 's' : ''}`),
          r.operations.map((o) => line(`${fmt.time(o.at)} · ${o.type} · ${o.label}`, fmt.money(o.amount))),
        )
      : null,
  );
}

// Not on the shift yet: the last mini report, then « Continuer le poste ».
export function renderJoin(page, ctx, state, remarks = []) {
  const s = state.shift;
  const tol = ctx.state.settings.cashTolerance;
  const go = async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api.post(`/shifts/${s.id}/join`);
      toast('Bon courage !');
      renderAttendant(page, ctx);
    } catch (err) {
      toast(err.message, 'error');
      renderAttendant(page, ctx);
    }
  };
  setContent(
    page,
    pageHeader('Poste en cours', `Poste n°${s.id} · ouvert le ${fmt.dateTime(s.opened_at)}`),
    remarks,
    h('p', { class: 'muted', style: 'margin-bottom:16px' }, s.on_duty.length ? `En service : ${s.on_duty.join(', ')}` : 'Personne en service'),
    state.lastReport ? reportCard(state.lastReport, tol, { title: `Rapport de ${state.lastReport.by || 'la relève'}` }) : null,
    h('div', { style: 'margin-top:20px' }, button(state.lastReport ? 'Continuer le poste' : 'Prendre le poste', go, { variant: 'large block' })),
  );
}

// Relief, evening closing or morning opening: every index, the money, a live mini report.
export function renderCheckpoint(page, ctx, shift, kind, { report } = {}) {
  const k = KIND[kind];
  const tol = ctx.state.settings.cashTolerance;
  const last = shift.checkpoints.at(-1);
  const lastMeter = (r) => last?.nozzles.find((n) => n.nozzle_id === r.nozzle_id)?.to ?? r.start_meter;
  const morning = kind === 'ouverture';
  const preview = h('div');
  let timer;

  const form = h('form', { class: 'stack' });
  const readings = () => shift.readings.map((r) => ({ nozzleId: r.nozzle_id, meter: form.elements[`m_${r.nozzle_id}`].value, photoId: form.elements[`m_${r.nozzle_id}`].dataset.photoId }));
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const list = readings();
      if (list.some((x) => x.meter === '')) return setContent(preview);
      try {
        const r = await api.post(`/shifts/${shift.id}/checkpoints/preview`, { kind, readings: list.map((x) => ({ nozzleId: x.nozzleId, meter: Number(x.meter) })) });
        setContent(preview, reportCard(r, tol, { preview: true, title: 'Depuis l’ouverture du poste' }));
      } catch (err) {
        setContent(preview, h('p', { class: 'variance-neg' }, err.message));
      }
    }, 300);
  };

  const parts = [
    morning
      ? h('div', { hidden: true }, shift.readings.map((r) => h('input', { type: 'hidden', name: `m_${r.nozzle_id}`, value: String(lastMeter(r)) })))
      : card(
      cardHeader('1. Index', null),
      h(
        'div',
        { class: 'stack' },
        shift.readings.map((r) =>
          withMeterPhoto(field({
            name: `m_${r.nozzle_id}`,
            label: r.product_name,
            hint: `Ouverture : ${fmt.number(r.start_meter)}${last ? ` · dernier relevé : ${fmt.number(lastMeter(r))}` : ''}`,
            type: 'number',
            step: '0.01',
            min: String(lastMeter(r)),
            required: true,
            onInput: refresh,
          }), { product: r.product_name, last: lastMeter(r), nozzleId: r.nozzle_id }),
        ),
      ),
    ),
    morning ? null : preview,
    card(
      cardHeader(morning ? 'Argent' : '2. Argent'),
      h(
        'div',
        { class: 'form-grid' },
        field({ name: 'cash', label: k.money, type: 'number', step: '0.01', min: '0', required: true, value: morning && report ? report.cash : undefined }),
        field({ name: 'note', label: 'Remarque (facultatif)', full: true }),
      ),
    ),
    h(
      'div',
      { class: 'grid grid-2' },
      morning ? h('span') : button('Retour', () => renderAttendant(page, ctx), { variant: 'large return' }),
      button(k.submit, null, { variant: 'large', type: 'submit' }),
    ),
  ];
  form.append(...parts.filter(Boolean));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!(await confirmDialog(`${k.submit} ?`, null, { confirmLabel: k.submit }))) return;
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    try {
      const done = await api.post(`/shifts/${shift.id}/checkpoints`, {
        kind,
        readings: readings().map((x) => ({ nozzleId: x.nozzleId, meter: Number(x.meter) })),
        cash: Number(form.elements.cash.value) || 0,
        note: form.elements.note.value,
      });
      if (morning) {
        toast('Station ouverte : le poste continue.');
        return renderAttendant(page, ctx);
      }
      setContent(
        page,
        pageHeader(k.done, null),
        reportCard(done.report, tol, { title: 'Votre rapport' }),
        h('div', { style: 'margin-top:20px' }, button('Terminé', () => renderAttendant(page, ctx), { variant: 'large block' })),
      );
    } catch (err) {
      submit.disabled = false;
      toast(err.message, 'error');
    }
  });

  setContent(
    page,
    pageHeader(k.title, `Poste n°${shift.id}`),
    morning && report ? h('div', { style: 'margin-bottom:20px' }, reportCard(report, tol, { title: `Fermeture d’hier soir${report.by ? ` · ${report.by}` : ''}` })) : null,
    form,
  );
}
