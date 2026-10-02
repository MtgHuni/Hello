import { icon } from './icons.js';

// ---------- DOM builder ----------
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') el.style.cssText = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') el.value = value;
    else if (key === 'checked') el.checked = !!value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

// ---------- Formatting ----------
const moneyFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' });
const numFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const priceFmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export const fmt = {
  money: (n) => moneyFmt.format(Number(n) || 0),
  signedMoney: (n) => (n > 0 ? '+' : '') + moneyFmt.format(Number(n) || 0),
  liters: (n) => `${numFmt.format(Number(n) || 0)} L`,
  number: (n) => numFmt.format(Number(n) || 0),
  price: (n) => `${priceFmt.format(Number(n) || 0)} $/L`,
  date: (s) => (s ? parseServerDate(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'),
  dateTime: (s) =>
    s
      ? parseServerDate(s).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '—',
  time: (s) => (s ? parseServerDate(s).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'),
  day: (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }),
  longDay: (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
};

// Server timestamps are UTC "YYYY-MM-DD HH:MM:SS".
export function parseServerDate(s) {
  return new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
}

export const isoDate = (d) => d.toLocaleDateString('sv-SE');
export const todayISO = () => isoDate(new Date());

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

// Product colour follows the product (its id), never its rank in a list.
export function productColor(productId) {
  return `var(--series-${((Number(productId) - 1) % 4) + 1})`;
}

// ---------- Feedback ----------
export function toast(message, type = 'info') {
  const el = h('div', { class: `toast ${type === 'error' ? 'error' : ''}`, role: 'status' }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), type === 'error' ? 5000 : 3000);
}

export function badge(text, level = '') {
  return h('span', { class: `badge ${level}` }, h('span', { class: 'dot' }), text);
}

export const SHIFT_STATUS = {
  open: ['En cours', 'info'],
  closed: ['À valider', 'warning'],
  validated: ['Validé', 'good'],
};

export function shiftBadge(status) {
  const [label, level] = SHIFT_STATUS[status] || [status, ''];
  return badge(label, level);
}

export function varianceCell(value, tolerance) {
  if (value === null || value === undefined) return h('span', { class: 'muted' }, '—');
  const ok = Math.abs(value) <= tolerance;
  return h(
    'span',
    { class: ok ? '' : value < 0 ? 'variance-neg' : 'variance-pos', title: ok ? 'Dans la tolérance' : 'Hors tolérance' },
    ok ? '' : value < 0 ? '▼ ' : '▲ ',
    fmt.signedMoney(value),
  );
}

// ---------- Layout pieces ----------
export function pageHeader(title, subtitle, ...actions) {
  return h(
    'header',
    { class: 'page-header' },
    h('div', {}, h('h1', {}, title), subtitle ? h('p', {}, subtitle) : null),
    actions.length ? h('div', { class: 'row no-print' }, actions) : null,
  );
}

export function button(label, onClick, { variant = '', iconName, type = 'button', ...rest } = {}) {
  return h('button', { class: `btn ${variant}`, type, onClick, ...rest }, iconName ? icon(iconName) : null, label);
}

export function card(...children) {
  return h('section', { class: 'card' }, children);
}

export function cardHeader(title, subtitle, ...actions) {
  return h(
    'div',
    { class: 'card-header' },
    h('div', {}, h('h2', {}, title), subtitle ? h('p', {}, subtitle) : null),
    actions.length ? h('div', { class: 'row no-print' }, actions) : null,
  );
}

export function kpi(label, value, sub, extra = {}) {
  return h('div', { class: 'card kpi' }, h('div', { class: 'label' }, label), h('div', { class: `value ${extra.small ? 'sm' : ''}` }, value), sub ? h('div', { class: 'sub' }, sub) : null);
}

export function table(columns, rows, { onRowClick, empty = 'Aucune donnée.', footer } = {}) {
  if (!rows.length) return h('div', { class: 'empty' }, empty);
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.align === 'right' ? 'right' : '' }, c.label)))),
      h(
        'tbody',
        {},
        rows.map((row) =>
          h(
            'tr',
            { class: onRowClick ? 'clickable' : '', onClick: onRowClick ? () => onRowClick(row) : null },
            columns.map((c) => h('td', { class: [c.align === 'right' ? 'right' : '', c.wrap ? 'wrap' : ''].join(' ') }, c.render ? c.render(row) : row[c.key])),
          ),
        ),
      ),
      footer ? h('tfoot', {}, h('tr', {}, columns.map((c) => h('td', { class: c.align === 'right' ? 'right' : '' }, footer[c.key] ?? '')))) : null,
    ),
  );
}

export function segmented(options, current, onChange) {
  return h(
    'div',
    { class: 'segmented', role: 'tablist' },
    options.map(([value, label]) =>
      h('button', { type: 'button', role: 'tab', class: value === current ? 'active' : '', 'aria-selected': String(value === current), onClick: () => onChange(value) }, label),
    ),
  );
}

// Tank level meter: fill in the product colour, low-level threshold marked,
// status shown with an icon + label (never colour alone).
export function tankGauge(tank) {
  const pct = Math.max(0, Math.min(100, (tank.book_stock / tank.capacity) * 100));
  const low = tank.book_stock <= tank.low_level;
  return h(
    'div',
    { class: 'tank' },
    h(
      'div',
      { class: 'tank-head' },
      h('div', {}, h('h3', {}, tank.name), h('div', { class: 'muted small' }, h('span', { class: 'swatch', style: `background:${productColor(tank.product_id)}` }), tank.product_name)),
      h('div', { class: 'tank-pct' }, `${Math.round(pct)} %`),
    ),
    h(
      'div',
      {
        class: 'meter',
        role: 'meter',
        'aria-valuemin': '0',
        'aria-valuemax': String(tank.capacity),
        'aria-valuenow': String(tank.book_stock),
        'aria-label': `${tank.name} : ${fmt.liters(tank.book_stock)} sur ${fmt.liters(tank.capacity)}`,
      },
      h('div', { class: 'meter-fill', style: `width:${pct}%;background:${productColor(tank.product_id)}` }),
      h('div', { class: 'meter-mark', style: `left:${(tank.low_level / tank.capacity) * 100}%`, title: `Seuil d'alerte : ${fmt.liters(tank.low_level)}` }),
    ),
    h(
      'div',
      { class: 'tank-foot' },
      h('span', { class: 'num' }, `${fmt.liters(tank.book_stock)} / ${fmt.liters(tank.capacity)}`),
      low ? badge('Stock bas', 'critical') : badge('Niveau correct', 'good'),
    ),
  );
}

// ---------- Dialogs ----------
export function openDialog(build) {
  const dialog = h('dialog', {});
  document.body.append(dialog);
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dialog.append(build(close));
  dialog.showModal();
  return { dialog, close };
}

export function field(f) {
  const id = `f-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
  let input;
  if (f.type === 'select') {
    input = h('select', { id, name: f.name, required: f.required }, f.options.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(f.value ?? '') }, l)));
  } else if (f.type === 'textarea') {
    input = h('textarea', { id, name: f.name, placeholder: f.placeholder }, f.value ?? '');
  } else if (f.type === 'checkbox') {
    return h('label', { class: `row ${f.full ? 'full' : ''}`, style: 'gap:10px' }, h('input', { type: 'checkbox', name: f.name, checked: f.value }), f.label);
  } else {
    input = h('input', {
      id,
      name: f.name,
      type: f.type || 'text',
      value: f.value ?? '',
      required: f.required,
      step: f.step,
      min: f.min,
      placeholder: f.placeholder,
      autocomplete: f.autocomplete || 'off',
      inputmode: f.inputmode || (f.type === 'number' ? 'decimal' : null),
      readonly: f.readonly,
    });
  }
  if (f.onInput) input.addEventListener('input', f.onInput);
  return h('label', { class: `field ${f.full ? 'full' : ''}`, for: id }, h('span', {}, f.label), input, f.hint ? h('span', { class: 'hint' }, f.hint) : null);
}

export function readForm(form, fields) {
  const data = {};
  for (const f of fields) {
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === 'checkbox') data[f.name] = el.checked;
    else if (f.type === 'number') data[f.name] = el.value === '' ? null : Number(el.value);
    else data[f.name] = el.value;
  }
  return data;
}

// Generic form dialog. onSubmit may throw: the message is shown inline.
export function formDialog({ title, intro, fields, submitLabel = 'Enregistrer', onSubmit, extra, grid = true }) {
  return new Promise((resolve) => {
    openDialog((close) => {
      const error = h('p', { class: 'form-error', hidden: true });
      const submit = h('button', { class: 'btn', type: 'submit' }, submitLabel);
      const form = h(
        'form',
        { class: 'dialog-body' },
        h('h2', {}, title),
        intro ? h('p', { class: 'muted' }, intro) : null,
        h('div', { class: grid ? 'form-grid' : 'stack' }, fields.map((f) => field(f))),
        extra ? extra() : null,
        error,
        h('div', { class: 'dialog-actions' }, button('Annuler', () => { close(); resolve(null); }, { variant: 'secondary' }), submit),
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        submit.disabled = true;
        error.hidden = true;
        try {
          const result = await onSubmit(readForm(form, fields), form);
          close();
          resolve(result ?? true);
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          submit.disabled = false;
        }
      });
      setTimeout(() => form.querySelector('input:not([readonly]),select,textarea')?.focus(), 30);
      return form;
    });
  });
}

export function confirmDialog(title, text, { confirmLabel = 'Confirmer', danger = false } = {}) {
  return new Promise((resolve) => {
    openDialog((close) =>
      h(
        'div',
        { class: 'dialog-body' },
        h('h2', {}, title),
        text ? h('p', { class: 'muted' }, text) : null,
        h(
          'div',
          { class: 'dialog-actions' },
          button('Annuler', () => { close(); resolve(false); }, { variant: 'secondary' }),
          button(confirmLabel, () => { close(); resolve(true); }, { variant: danger ? 'danger' : '' }),
        ),
      ),
    );
  });
}

export function errorState(err) {
  return h('div', { class: 'card empty' }, h('p', {}, 'Impossible de charger cette page.'), h('p', { class: 'small' }, err.message));
}
