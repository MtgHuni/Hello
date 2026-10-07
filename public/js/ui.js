import { icon } from './icons.js';
import { withMeterPhoto, withPhoto } from './photo.js';

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

// Like el.replaceChildren(), but skips null/false and flattens arrays
// (replaceChildren would print "null" or "[object HTMLDivElement]").
export function setContent(el, ...children) {
  el.replaceChildren();
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

// Programme de combos activé ? Réglage du gérant, posé par main.js au démarrage.
export const flags = { combos: true, readonly: false, admin: false, ai: false, ask: false, station: '' };
// The owner (actionnaire) sees everything and changes nothing: a control that writes is left out.
export const edit = (node) => (flags.readonly ? null : node);
// The settings and the cash book: changed by the admin only (the manager reads them).
export const canAdmin = () => !flags.readonly && flags.admin;
export const adminEdit = (node) => (canAdmin() ? node : null);

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
// Date-only values ("YYYY-MM-DD") are local calendar days.
export function parseServerDate(s) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T12:00:00`);
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

// Signature « Totem » : les prix du jour comme sur le totem de la station,
// un champ de couleur par carburant, les chiffres en grand.
// items : [{ id, name, price, subscriberPrice }]
export function priceTotem(items) {
  if (!items.length) return null;
  return h(
    'section',
    { class: 'totem', 'aria-label': 'Prix du jour' },
    items.map((p) =>
      h(
        'div',
        { class: 'totem-panel', style: `--product:${productColor(p.id)}` },
        h('span', { class: 'totem-name' }, p.name),
        h('span', { class: 'totem-price' }, priceFmt.format(Number(p.price) || 0), h('small', {}, '$/L')),
        p.subscriberPrice != null && Number(p.subscriberPrice) !== Number(p.price) ? h('span', { class: 'totem-sub' }, `Abonnés ${fmt.price(p.subscriberPrice)}`) : null,
      ),
    ),
  );
}

// ---------- Feedback ----------
// `action`: one button in the toast (e.g. the WhatsApp receipt), which then stays longer.
export function toast(message, type = 'info', { action } = {}) {
  const leave = () => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 600);
  };
  const el = h(
    'div',
    { class: `toast ${type === 'error' ? 'error' : ''}`, role: type === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-icon' }, icon(type === 'error' ? 'alert' : 'check')),
    h('span', {}, message),
    action
      ? h('a', { class: 'btn secondary sm toast-action', href: action.href, target: '_blank', rel: 'noopener', 'aria-label': action.ariaLabel, onClick: () => setTimeout(leave, 300) }, action.icon, action.label)
      : null,
  );
  document.getElementById('toasts').append(el);
  setTimeout(leave, action ? 8000 : type === 'error' ? 4500 : 2600);
}

// The customer's receipt through WhatsApp: to their number, or to a contact picked in WhatsApp.
export function receipt(customer, lines, balance) {
  const when = new Date().toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const owed = balance > 0.001 ? `Vous devez : ${fmt.money(balance)}` : balance < -0.001 ? `Votre avance : ${fmt.money(-balance)}` : `Solde : ${fmt.money(0)}`;
  const text = [flags.station, when, `Client : ${customer.name}`, ...lines, balance == null ? null : owed].filter(Boolean).join('\n');
  return {
    label: 'Reçu',
    ariaLabel: 'Envoyer le reçu par WhatsApp',
    icon: h('span', { class: 'logo-whatsapp', 'aria-hidden': 'true' }),
    href: `https://wa.me/${whatsappNumber(customer.phone) || ''}?text=${encodeURIComponent(text)}`,
  };
}

export function spinner() {
  return h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Chargement' }, Array.from({ length: 8 }, (_, i) => h('span', { style: `transform:rotate(${i * 45}deg);animation-delay:${-0.8 + i * 0.1}s` })));
}

export function badge(text, level = '') {
  return h('span', { class: `badge ${level}` }, h('span', { class: 'dot' }), text);
}

export const SHIFT_STATUS = {
  open: ['En cours', 'info'],
  closed: ['Clôturé', 'good'],
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
    fmt.signedMoney(value),
  );
}

// ---------- Layout pieces ----------
// Ligne de poste : le cycle d'un poste en trois arrêts, l'arrêt en cours éclairé en jaune.
// L'arrêt courant brûle, les arrêts passés sont pleins, les suivants sont des cercles creux.
const LINE_STOPS = ['Ouverture', 'Ventes', 'Clôture'];
export function shiftLine(status) {
  const current = status === 'open' ? 1 : 3; // 3 = tout est passé
  return h(
    'ol',
    { class: 'shift-line', 'aria-label': 'Avancement du poste' },
    LINE_STOPS.map((label, i) =>
      h(
        'li',
        { class: i < current ? 'done' : i === current ? 'now' : '', 'aria-current': i === current ? 'step' : null },
        h('span', { class: 'stop' }),
        h('span', { class: 'stop-label' }, label),
      ),
    ),
  );
}

// Buttons grouped in one place all take the width of the widest one: up to four on a line,
// more on two lines. On a phone they go two by two, half the width each, centred.
export function buttonRow(items, { inline = false } = {}) {
  const list = [items].flat(Infinity).filter(Boolean);
  if (!list.length) return null;
  const cols = list.length <= 4 ? list.length : Math.ceil(list.length / 2);
  return h('div', { class: `btn-row no-print${inline ? ' inline' : ''}${list.length === 1 ? ' one' : ''}`, style: `--cols:${cols}` }, list);
}

// A status badge goes under the title; the buttons line up beside it, all the same size.
export function pageHeader(title, subtitle, ...actions) {
  const items = actions.flat(Infinity).filter(Boolean);
  const badges = items.filter((a) => a.classList?.contains('badge'));
  const buttons = items.filter((a) => !a.classList?.contains('badge'));
  return h(
    'header',
    { class: 'page-header' },
    h('div', {}, h('h1', {}, title), subtitle ? h('p', {}, subtitle) : null, badges.length ? h('div', { class: 'header-badges' }, badges) : null),
    buttonRow(buttons),
  );
}

// Names already recorded (the suppliers) offered under a text field while it is typed: up to three
// chips, those starting with the text first; one tap fills the field. Use: { ...field, onInput },
// then node beside it.
export function nameChips(names = []) {
  const norm = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  const chips = h('div', { class: 'chips', 'aria-live': 'polite' });
  const onInput = (e) => {
    const input = e.target;
    const q = norm(input.value);
    chips.replaceChildren();
    if (!q) return;
    const found = names
      .filter((n) => norm(n).includes(q) && norm(n) !== q)
      .sort((a, b) => norm(b).startsWith(q) - norm(a).startsWith(q))
      .slice(0, 3);
    for (const n of found) chips.append(h('button', { type: 'button', class: 'chip', onClick: () => ((input.value = n), chips.replaceChildren(), input.focus()) }, n));
  };
  return { onInput, node: { name: 'nameChips', type: 'node', full: true, node: chips } };
}

export function button(label, onClick, { variant = '', iconName, type = 'button', ...rest } = {}) {
  return h('button', { class: `btn ${variant}`, type, onClick, ...rest }, iconName ? icon(iconName) : null, label);
}

// A PDF to download, plus a "Partager" button when the phone can share files
// (WhatsApp, e-mail…): the file goes through the phone's share sheet.
export function pdfLinks(url, filename, { label = 'Rapport PDF', variant = 'secondary' } = {}) {
  const link = h('a', { class: `btn ${variant}`, href: url, download: filename }, icon('download'), label);
  const canShare = typeof File === 'function' && navigator.canShare?.({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] });
  if (!canShare) return link;
  const share = button(
    'Partager',
    async () => {
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error();
        const file = new File([await res.blob()], filename, { type: 'application/pdf' });
        await navigator.share({ files: [file], title: filename });
      } catch (err) {
        if (err?.name !== 'AbortError') toast('Partage impossible : téléchargez le PDF.', 'error');
      }
    },
    { variant, iconName: 'share' },
  );
  return [link, share];
}

// A PDF through the phone's share sheet (WhatsApp, e-mail…), or a plain download
// where the browser cannot share files.
export async function sharePdf(url, filename) {
  const canShare = typeof File === 'function' && navigator.canShare?.({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] });
  const download = () => h('a', { href: url, download: filename }).click();
  if (!canShare) return download();
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error();
    const file = new File([await res.blob()], filename, { type: 'application/pdf' });
    await navigator.share({ files: [file], title: filename });
  } catch (err) {
    // The share sheet needs a fresh tap: after a long wait, download instead.
    if (err?.name === 'NotAllowedError') return download();
    if (err?.name !== 'AbortError') toast('Partage impossible : réessayez.', 'error');
  }
}

// A single "Partager" button for a PDF.
export function shareButton(url, filename, { variant = 'secondary' } = {}) {
  return button('Partager', () => sharePdf(url, filename), { variant, iconName: 'share' });
}

// A closed shift's PDF report (cash, sales from the indexes, credits, expenses), shared.
export function reportLink(shiftId, variant = 'secondary') {
  return shareButton(`/api/shifts/${shiftId}/report.pdf`, `rapport-poste-${shiftId}.pdf`, { variant });
}

// WhatsApp number from a Congolese phone (+243…, 0…, or 9 digits).
export function whatsappNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = `243${d.slice(1)}`;
  else if (d.length === 9) d = `243${d}`;
  return d.length >= 11 ? d : null;
}

export function card(...children) {
  return h('section', { class: 'card' }, children);
}

export function cardHeader(title, subtitle, ...actions) {
  return h(
    'div',
    { class: 'card-header' },
    h('div', {}, h('h2', {}, title), subtitle ? h('p', {}, subtitle) : null),
    buttonRow(actions),
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
            {
              class: onRowClick ? 'clickable' : '',
              tabindex: onRowClick ? '0' : null,
              onClick: onRowClick ? () => onRowClick(row) : null,
              onKeydown: onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : null,
            },
            columns.map((c) => h('td', { class: [c.align === 'right' ? 'right' : '', c.wrap ? 'wrap' : ''].join(' ') }, c.render ? c.render(row) : row[c.key])),
          ),
        ),
      ),
      footer ? h('tfoot', {}, h('tr', {}, columns.map((c) => h('td', { class: c.align === 'right' ? 'right' : '' }, footer[c.key] ?? '')))) : null,
    ),
  );
}

// Segmented control: the thumb slides (spring) to the tapped segment,
// then the view is re-rendered once the motion has mostly settled.
export function segmented(options, current, onChange) {
  const thumb = h('span', { class: 'thumb', 'aria-hidden': 'true' });
  const el = h('div', { class: 'segmented', role: 'tablist' }, thumb);
  const place = (btn, animate) => {
    if (!btn || !btn.offsetWidth) return false;
    if (!animate) thumb.style.transition = 'none';
    thumb.style.width = `${btn.offsetWidth}px`;
    thumb.style.transform = `translateX(${btn.offsetLeft}px)`;
    if (!animate) requestAnimationFrame(() => (thumb.style.transition = ''));
    return true;
  };
  const buttons = options.map(([value, label]) => {
    const btn = h('button', { type: 'button', role: 'tab', class: value === current ? 'active' : '', 'aria-selected': String(value === current) }, label);
    btn.addEventListener('click', () => {
      if (value === current) return;
      buttons.forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', String(b === btn));
      });
      place(btn, true);
      setTimeout(() => onChange(value), 260);
    });
    return btn;
  });
  el.append(...buttons);
  const active = () => buttons.find((b) => b.classList.contains('active'));
  // Position once the control is laid out (it may be built before being attached).
  const settle = (tries = 0) => {
    if (!place(active(), false) && tries < 60) requestAnimationFrame(() => settle(tries + 1));
  };
  settle();
  if ('ResizeObserver' in window) new ResizeObserver(() => place(active(), false)).observe(el);
  return el;
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
// kind: 'sheet' (forms), 'alert' (confirmations), 'action' (action sheet).
// While a sheet or an alert is open, the page behind it stays still: a finger moving on the
// sheet scrolls only the sheet's own content, never the screen underneath.
let openDialogs = 0;
function lockPage(on) {
  openDialogs += on ? 1 : -1;
  document.documentElement.classList.toggle('dialog-open', openDialogs > 0);
}
// Inside the sheet, a touch may scroll an element that can scroll (the form, a table);
// anywhere else (header, footer, backdrop, a form that fits) it would move the page.
function scrollsInside(el, stop) {
  for (; el && el !== stop; el = el.parentElement) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1) return true;
    if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
}

export function openDialog(build, { kind = 'sheet' } = {}) {
  const dialog = h('dialog', { class: `${kind}-dialog` });
  document.body.append(dialog);
  let closing = false;
  lockPage(true);
  dialog.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && !scrollsInside(e.target, dialog)) e.preventDefault();
  }, { passive: false });
  const close = () => {
    if (closing) return;
    closing = true;
    const panel = dialog.firstElementChild;
    dialog.classList.add('closing');
    panel?.classList.add('closing');
    const done = () => {
      if (!dialog.isConnected) return;
      dialog.close();
      dialog.remove();
      lockPage(false);
    };
    if (!panel || matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    panel.addEventListener('animationend', done, { once: true });
    setTimeout(done, 450);
  };
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  // Tap on the dimmed backdrop dismisses sheets and action sheets (not alerts).
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && kind !== 'alert') close();
  });
  dialog.append(build(close));
  // Focus the dialog itself rather than its first button, so no focus ring
  // shows up on open (iOS sheets and menus open with nothing selected).
  dialog.tabIndex = -1;
  dialog.showModal();
  dialog.focus({ preventScroll: true });
  return { dialog, close };
}

// Swipe a sheet down by its header/grabber to dismiss it (touch & mouse).
function enableSwipeToDismiss(sheet, handle, close) {
  let startY = null;
  let dy = 0;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || !matchMedia('(max-width: 760px)').matches) return;
    startY = e.clientY;
    dy = 0;
    sheet.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    dy = Math.max(0, e.clientY - startY);
    // Rubber-band resistance, like UIKit.
    sheet.style.transform = `translateY(${dy < 0 ? dy / 3 : dy}px)`;
  });
  const end = () => {
    if (startY === null) return;
    startY = null;
    sheet.classList.remove('dragging');
    sheet.style.transition = 'transform 0.45s var(--ease)';
    if (dy > 110) {
      sheet.style.transform = 'translateY(110%)';
      setTimeout(close, 200);
    } else {
      sheet.style.transform = '';
    }
    setTimeout(() => (sheet.style.transition = ''), 460);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

export function field(f) {
  if (f.type === 'node') return f.node;
  const id = `f-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
  let input;
  if (f.type === 'checkbox') {
    // Boolean settings use the iOS switch.
    return h(
      'label',
      { class: `switch-row ${f.full ? 'full' : ''}`, for: id },
      h('span', {}, f.label),
      h('input', { id, type: 'checkbox', class: 'switch', role: 'switch', name: f.name, checked: f.value }),
    );
  }
  if (f.type === 'segment') {
    // One-tap choice (radio pills): faster than a select at the pump.
    const current = String(f.value ?? f.options[0]?.[0]);
    return h(
      'fieldset',
      { class: `seg-field ${f.full ? 'full' : ''}`, hidden: f.hidden },
      h('legend', {}, f.label),
      h(
        'div',
        { class: 'seg-options' },
        f.options.map(([v, l]) =>
          h('label', { class: 'seg-option' }, h('input', { type: 'radio', name: f.name, value: String(v), checked: String(v) === current, onChange: f.onInput }), h('span', {}, l)),
        ),
      ),
    );
  }
  if (f.type === 'select') {
    input = h('select', { id, name: f.name, required: f.required }, f.options.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(f.value ?? '') }, l)));
  } else if (f.type === 'textarea') {
    input = h('textarea', { id, name: f.name, placeholder: f.placeholder || ' ' }, f.value ?? '');
  } else {
    input = h('input', {
      id,
      name: f.name,
      type: f.type || 'text',
      value: f.value ?? '',
      required: f.required,
      step: f.step,
      min: f.min,
      max: f.max,
      // A placeholder is always set so the floating label can tell an empty field (:placeholder-shown).
      placeholder: f.placeholder || ' ',
      autocomplete: f.autocomplete || 'off',
      inputmode: f.inputmode || (f.type === 'number' ? 'decimal' : null),
      readonly: f.readonly,
      list: f.list,
      enterkeyhint: f.enterkeyhint,
    });
  }
  if (f.onInput) input.addEventListener('input', f.onInput);
  // Floating-label field: the label sits inside the box and floats up once the field is used.
  // Selects, text areas and dates always show a value, so their label stays up.
  const pinned = f.type === 'select' || f.type === 'textarea' || f.type === 'date';
  const el = h(
    'label',
    { class: `field ${f.full ? 'full' : ''}`, for: id, hidden: f.hidden },
    h('span', { class: `field-box ${pinned ? 'pinned' : ''}` }, input, h('span', { class: 'field-label' }, f.label)),
    f.hint ? h('span', { class: 'hint' }, f.hint) : null,
  );
  // A meter index: the camera beside it (`meterPhoto: { product, last }`).
  if (f.meterPhoto) return withMeterPhoto(el, f.meterPhoto);
  // Any other photo read by Claude (`photo: { label, onImage(image, input) }`).
  if (f.photo) return withPhoto(el, { label: f.photo.label, onImage: (image) => f.photo.onImage(image, input) });
  return el;
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

// Form in a sheet (right drawer on wide screens, bottom sheet on phones): title and ✕ on top, the action as a full-width slab at the bottom.
// onSubmit may throw: the message is shown inline.
export function formDialog({ title, intro, fields, submitLabel = 'Enregistrer', onSubmit, extra, grid = true, autofocus = false }) {
  return new Promise((resolve) => {
    let settled = false;
    let saving = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const { dialog } = openDialog((close) => {
      const dismiss = () => {
        if (saving) return;
        close();
        finish(null);
      };
      const error = h('p', { class: 'form-error', hidden: true, role: 'alert' });
      const submit = h('button', { class: 'btn large block', type: 'submit' }, submitLabel);
      const header = h(
        'div',
        { class: 'sheet-header' },
        h('h2', {}, title),
        h('button', { class: 'circle-btn', type: 'button', 'aria-label': 'Fermer', title: 'Fermer', onClick: dismiss }, icon('close')),
      );
      const handle = h('div', { class: 'sheet-handle' }, h('div', { class: 'sheet-grabber', 'aria-hidden': 'true' }), header);
      const form = h(
        'form',
        { class: 'sheet' },
        handle,
        h(
          'div',
          { class: 'sheet-body' },
          intro ? h('p', { class: 'intro' }, intro) : null,
          h('div', { class: grid ? 'form-grid' : 'stack', style: grid ? '' : 'gap:14px' }, fields.map((f) => field(f))),
          extra ? extra() : null,
          error,
        ),
        h('div', { class: 'sheet-footer' }, submit),
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (saving) return;
        saving = true;
        submit.disabled = true;
        submit.setAttribute('aria-busy', 'true');
        error.hidden = true;
        try {
          const result = await onSubmit(readForm(form, fields), form);
          saving = false;
          close();
          finish(result ?? true);
        } catch (err) {
          saving = false;
          error.textContent = err.message;
          error.hidden = false;
          submit.disabled = false;
          submit.removeAttribute('aria-busy');
        }
      });
      enableSwipeToDismiss(form, handle, dismiss);
      setTimeout(() => {
        // On phones only when asked (the keyboard opens): the attendant's forms start with typing.
        if (autofocus || matchMedia('(hover: hover)').matches) form.querySelector('.sheet-body input:not([readonly]):not([type=radio]),.sheet-body select,.sheet-body textarea')?.focus();
      }, 60);
      return form;
    });
    dialog.addEventListener('cancel', (e) => {
      if (saving) e.preventDefault();
    });
    dialog.addEventListener('close', () => finish(null));
  });
}

// iOS alert: title, message, two capsule buttons.
export function confirmDialog(title, text, { confirmLabel = 'Confirmer', danger = false } = {}) {
  return new Promise((resolve) => {
    openDialog(
      (close) =>
        h(
          'div',
          { class: 'alert', role: 'alertdialog', 'aria-label': title },
          h('h2', {}, title),
          text ? h('p', {}, text) : null,
          h(
            'div',
            { class: 'alert-actions' },
            button('Annuler', () => { close(); resolve(false); }, { variant: 'cancel' }),
            button(confirmLabel, () => { close(); resolve(true); }, { variant: danger ? 'destructive' : '' }),
          ),
        ),
      { kind: 'alert' },
    );
  });
}

// An alert that stops the action: a card in the middle of the screen, a mark, a title, what to know,
// and one button to close it.
export function noticeDialog(title, body, { okLabel = 'Compris', level = 'critical', iconName = 'alert', wide = false } = {}) {
  return new Promise((resolve) => {
    openDialog(
      (close) =>
        h(
          'div',
          { class: `alert notice${wide ? ' wide' : ''}`, role: 'alertdialog', 'aria-label': title },
          h('span', { class: `alert-icon notice-icon ${level}`, 'aria-hidden': 'true' }, icon(iconName)),
          h('h2', {}, title),
          body,
          h('div', { class: 'alert-actions' }, button(okLabel, () => { close(); resolve(); })),
        ),
      { kind: 'alert' },
    );
  });
}

// iOS action sheet: grouped choices + a separate Cancel button.
export function actionSheet({ title, actions }) {
  openDialog(
    (close) =>
      h(
        'div',
        { class: 'action-sheet' },
        h(
          'div',
          { class: 'action-group' },
          title ? h('div', { class: 'title' }, title) : null,
          actions.map((a) =>
            h(
              'button',
              {
                type: 'button',
                class: a.destructive ? 'destructive' : '',
                onClick: () => {
                  close();
                  a.onClick();
                },
              },
              a.label,
            ),
          ),
        ),
        h('div', { class: 'action-group' }, h('button', { type: 'button', class: 'cancel', onClick: close }, 'Annuler')),
      ),
    { kind: 'action' },
  );
}

export function errorState(err, retry) {
  return h(
    'div',
    { class: 'card empty' },
    h('p', {}, 'Impossible de charger cette page.'),
    h('p', { class: 'small' }, err.message),
    retry ? h('div', { style: 'margin-top:16px' }, button('Réessayer', retry, { variant: 'secondary' })) : null,
  );
}

// Runs a button's action once at a time: the button waits, disabled, and an error becomes a toast.
export async function busy(btn, fn) {
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    await fn();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

// Key of one form: sent with the record, it makes a second sending harmless.
export const newRef = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

// Night (default) or day mode for the pump in full sun; remembered on the device.
export function applyTheme(theme) {
  if (theme === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'light' ? '#ffffff' : '#0a0a0b');
  for (const b of document.querySelectorAll('.theme-btn')) b.setAttribute('aria-pressed', String(theme === 'light'));
}

// The sun beside the account, as on iOS: one tap for day mode, lit while it is on.
export function themeButton() {
  return h('button', { class: 'theme-btn', type: 'button', 'aria-label': 'Mode jour (plein soleil)', 'aria-pressed': String(document.documentElement.dataset.theme === 'light'), onClick: toggleTheme }, icon('sun'));
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try {
    localStorage.setItem('theme', next);
  } catch {
    /* storage unavailable: the choice lasts until the page closes */
  }
}
