import { api } from './api.js';
import { h, initials, errorState, toast, formDialog, actionSheet, spinner } from './ui.js';
import { icon } from './icons.js';
import { renderLogin, renderSetup } from './views/auth.js';
import { renderDashboard } from './views/dashboard.js';
import { renderShifts, renderShiftDetail } from './views/shifts.js';
import { renderAttendant, renderMyShifts } from './views/attendant.js';
import { renderTanks } from './views/tanks.js';
import { renderCustomers, renderCustomerDetail } from './views/customers.js';
import { renderReports } from './views/reports.js';
import { renderSettings } from './views/settings.js';
import { renderAccount } from './views/account.js';

const root = document.getElementById('app');
export const state = { user: null, settings: null };

// [path, label, icon, view, short label for the tab bar]
const NAV = {
  manager: [
    ['', 'Tableau de bord', 'home', renderDashboard, 'Accueil'],
    ['postes', 'Postes', 'shifts', renderShifts],
    ['cuves', 'Cuves', 'tank', renderTanks],
    ['clients', 'Clients', 'users', renderCustomers],
    ['rapports', 'Rapports', 'chart', renderReports],
    ['pompe', 'Mon poste', 'pump', renderAttendant],
    ['reglages', 'Réglages', 'settings', renderSettings],
  ],
  attendant: [
    ['', 'Mon poste', 'pump', renderAttendant],
    ['historique', 'Historique', 'shifts', renderMyShifts],
  ],
  customer: [['', 'Mon compte', 'user', renderAccount]],
};

const DETAIL_ROUTES = {
  manager: { postes: renderShiftDetail, clients: renderCustomerDetail },
  attendant: { historique: renderShiftDetail },
};

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let shell = null;
let lastRoute = null;
let routeToken = 0;

export function navigate(path) {
  location.hash = `#/${path}`;
}

async function boot() {
  shell = null;
  lastRoute = null;
  try {
    const setup = await api.get('/setup');
    if (setup.needsSetup) return renderSetup(root, boot);
    const me = await api.get('/auth/me').catch(() => null);
    if (!me) return renderLogin(root, setup.stationName, boot);
    state.user = me.user;
    state.settings = me.settings;
    document.title = me.settings.stationName;
    route();
  } catch (err) {
    root.replaceChildren(h('div', { class: 'auth' }, errorState(err)));
  }
}

async function logout() {
  await api.post('/auth/logout').catch(() => {});
  state.user = null;
  location.hash = '';
  boot();
}

async function changePassword() {
  const ok = await formDialog({
    title: 'Mot de passe',
    grid: false,
    fields: [
      { name: 'current', label: 'Mot de passe actuel', type: 'password', required: true, autocomplete: 'current-password' },
      { name: 'password', label: 'Nouveau mot de passe', type: 'password', required: true, autocomplete: 'new-password', hint: '8 caractères minimum' },
    ],
    onSubmit: (d) => api.post('/auth/password', d),
  });
  if (ok) toast('Mot de passe modifié');
}

function accountMenu() {
  const actions = [{ label: 'Changer le mot de passe', onClick: changePassword }];
  if (state.user.role === 'manager') actions.push({ label: 'Mon poste (pompe)', onClick: () => navigate('pompe') });
  actions.push({ label: 'Se déconnecter', destructive: true, onClick: logout });
  actionSheet({ title: `${state.user.name} · ${state.settings.stationName}`, actions });
}

// ---------- Persistent shell: sidebar, toolbar, floating tab bar ----------

function buildShell() {
  const role = state.user.role;
  const nav = NAV[role];
  const appIcon = () => h('div', { class: 'app-icon' }, icon('pump'));

  const slot = h('div', { class: 'page-slot' });
  const title = h('div', { class: 'toolbar-title', 'aria-hidden': 'true' });
  const toolbar = h(
    'header',
    { class: 'toolbar' },
    h('div', { class: 'toolbar-leading' }, appIcon()),
    title,
    h(
      'div',
      { class: 'toolbar-trailing' },
      h('button', { class: 'circle-btn', type: 'button', 'aria-label': 'Mon compte', title: 'Mon compte', onClick: accountMenu }, h('span', { class: 'avatar' }, initials(state.user.name))),
    ),
  );

  const tabItems = role === 'manager' ? nav.filter(([p]) => p !== 'pompe') : nav;
  const lens = h('span', { class: 'tab-lens', 'aria-hidden': 'true' });
  const tabbar =
    tabItems.length > 1
      ? h('nav', { class: 'tabbar glass', 'aria-label': 'Navigation' }, lens, tabItems.map(([path, label, iconName, , short]) => h('a', { href: `#/${path}`, 'data-path': path }, icon(iconName), h('span', {}, short || label))))
      : null;

  const main = h('main', { class: 'main' }, toolbar, slot);
  let el;
  if (role === 'manager') {
    const sidebar = h(
      'aside',
      { class: 'sidebar glass' },
      h('div', { class: 'brand' }, appIcon(), h('span', { class: 'brand-name' }, state.settings.stationName)),
      h('nav', { class: 'nav' }, nav.map(([path, label, iconName]) => h('a', { href: `#/${path}`, 'data-path': path }, icon(iconName), h('span', {}, label)))),
      h(
        'div',
        { class: 'sidebar-footer' },
        h(
          'button',
          { class: 'user-chip', type: 'button', onClick: accountMenu },
          h('span', { class: 'avatar' }, initials(state.user.name)),
          h('span', { style: 'min-width:0;flex:1' }, h('span', { style: 'display:block;font-weight:600;font-size:15px' }, state.user.name), h('span', { class: 'small muted' }, 'Gérant')),
        ),
      ),
    );
    el = h('div', { class: 'shell manager' }, sidebar, main, tabbar);
  } else {
    el = h('div', { class: 'shell simple' }, main, tabbar);
  }

  shell = { role, el, slot, toolbar, title, tabbar, lens };

  // Lens follows the active tab; recomputed when the bar resizes (rotation, breakpoint).
  if (tabbar && 'ResizeObserver' in window) new ResizeObserver(() => moveLens(false)).observe(tabbar);
  return shell;
}

function moveLens(animate = true) {
  const { tabbar, lens } = shell;
  if (!tabbar) return;
  const active = tabbar.querySelector('a.active');
  if (!active || !active.offsetWidth) {
    lens.style.opacity = '0';
    return;
  }
  if (!animate) lens.style.transition = 'none';
  lens.style.opacity = '1';
  lens.style.width = `${active.offsetWidth}px`;
  lens.style.transform = `translateX(${active.offsetLeft}px)`;
  if (!animate) requestAnimationFrame(() => (lens.style.transition = ''));
}

function setActive(path) {
  shell.el.querySelectorAll('a[data-path]').forEach((a) => {
    const on = a.dataset.path === path;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  moveLens(!!lastRoute);
}

// Large title collapses into the toolbar once scrolled past (iOS behaviour).
function updateToolbar() {
  if (!shell) return;
  const h1 = shell.slot.querySelector('.page-header h1');
  const scrolled = h1 ? h1.getBoundingClientRect().bottom < 56 : window.scrollY > 40;
  shell.toolbar.classList.toggle('scrolled', scrolled);
  shell.toolbar.classList.toggle('edge', window.scrollY > 4);
  if (h1 && shell.title.textContent !== h1.textContent) shell.title.textContent = h1.textContent;
}
let ticking = false;
window.addEventListener(
  'scroll',
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      updateToolbar();
    });
  },
  { passive: true },
);

// Swap page content with a navigation transition: push / pop / cross-fade.
function swap(update, direction) {
  const finish = () => {
    shell.slot.classList.add('entering');
    setTimeout(() => shell.slot.classList.remove('entering'), 900);
  };
  if (direction === 'none' || reducedMotion()) {
    update();
    return finish();
  }
  if (document.startViewTransition) {
    document.documentElement.dataset.nav = direction;
    const t = document.startViewTransition(() => {
      update();
      if (direction === 'fade') finish();
    });
    t.finished.finally(() => delete document.documentElement.dataset.nav);
    return;
  }
  update();
  if (direction === 'fade') finish();
  else shell.slot.firstElementChild?.classList.add(`enter-${direction}`);
}

async function route() {
  if (!state.user) return;
  const [section = '', id] = location.hash.replace(/^#\/?/, '').split('/');
  const role = state.user.role;
  const nav = NAV[role];
  const entry = nav.find(([path]) => path === section) || nav[0];
  const detail = id ? DETAIL_ROUTES[role]?.[section] : null;
  const view = detail || entry[3];

  if (!shell || shell.role !== role) {
    buildShell();
    root.replaceChildren(shell.el);
  }

  const depth = detail ? 1 : 0;
  let direction = 'none';
  if (lastRoute) {
    if (depth > lastRoute.depth) direction = 'push';
    else if (depth < lastRoute.depth && entry[0] === lastRoute.section) direction = 'pop';
    else direction = 'fade';
  }
  lastRoute = { section: entry[0], depth };
  setActive(entry[0]);

  const token = ++routeToken;
  const page = h('div', { class: `page ${role === 'manager' ? '' : 'narrow'}` });
  const slow = setTimeout(() => {
    if (token === routeToken) shell.slot.replaceChildren(h('div', { class: 'loading' }, spinner()));
  }, 300);
  try {
    await view(page, { id, state, navigate, refresh: route });
  } catch (err) {
    page.replaceChildren(errorState(err));
  }
  clearTimeout(slow);
  if (token !== routeToken) return; // a newer navigation won

  swap(() => {
    shell.slot.replaceChildren(page);
    window.scrollTo(0, 0);
    updateToolbar();
  }, direction);
}

window.addEventListener('hashchange', route);
window.addEventListener('auth:lost', () => {
  if (state.user) {
    state.user = null;
    toast('Session expirée. Reconnectez-vous.', 'error');
    boot();
  }
});

boot();
