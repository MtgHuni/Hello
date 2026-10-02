import { api } from './api.js';
import { h, errorState, toast, formDialog, actionSheet, spinner } from './ui.js';
import { icon, brandMark } from './icons.js';
import { renderLogin, renderSetup } from './views/auth.js';
import { renderDashboard } from './views/dashboard.js';
import { renderShifts, renderShiftDetail } from './views/shifts.js';
import { renderAttendant, renderMyShifts } from './views/attendant.js';
import { renderTanks } from './views/tanks.js';
import { renderCustomers, renderCustomerDetail } from './views/customers.js';
import { renderReports } from './views/reports.js';
import { renderSettings } from './views/settings.js';
import { renderAccount } from './views/account.js';
import { renderExpenses } from './views/expenses.js';

const root = document.getElementById('app');
export const state = { user: null, settings: null };

// [path, label, icon, view, short label for the global nav]
const NAV = {
  manager: [
    ['', 'Tableau de bord', 'home', renderDashboard, 'Accueil'],
    ['postes', 'Postes', 'shifts', renderShifts],
    ['clients', 'Clients', 'users', renderCustomers],
    ['depenses', 'Dépenses', 'wallet', renderExpenses],
    ['cuves', 'Cuves', 'tank', renderTanks],
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

// ---------- Persistent shell (apple.com): global nav, local nav, full-screen menu ----------

function buildShell() {
  const role = state.user.role;
  const nav = NAV[role];
  const slot = h('div', { class: 'page-slot' });
  const links = () => nav.map(([path, label, , , short]) => h('a', { href: `#/${path}`, 'data-path': path }, short || label));

  // Full-screen menu on phones: large links that cascade in, like apple.com.
  const menu = h(
    'div',
    { class: 'menu', id: 'menu', hidden: true },
    h('nav', { class: 'menu-links', 'aria-label': 'Navigation' }, nav.map(([path, label], i) => h('a', { href: `#/${path}`, 'data-path': path, style: `--i:${i}`, onClick: () => toggleMenu(false) }, label))),
    h(
      'div',
      { class: 'menu-account', style: `--i:${nav.length}` },
      h('p', {}, `${state.user.name} · ${state.settings.stationName}`),
      h('button', { type: 'button', onClick: () => { toggleMenu(false); changePassword(); } }, 'Changer le mot de passe'),
      h('button', { type: 'button', onClick: () => { toggleMenu(false); logout(); } }, 'Se déconnecter'),
    ),
  );
  const menuButton =
    nav.length > 1
      ? h('button', { class: 'gnav-menu', type: 'button', 'aria-label': 'Menu', 'aria-expanded': 'false', 'aria-controls': 'menu', onClick: () => toggleMenu() }, h('span'), h('span'))
      : null;

  const gnav = h(
    'header',
    { class: 'gnav' },
    h(
      'div',
      { class: 'gnav-inner' },
      h('a', { class: 'gnav-mark', href: '#/', 'aria-label': `${state.settings.stationName}, accueil` }, brandMark(), h('span', {}, state.settings.stationName)),
      nav.length > 1 ? h('nav', { class: 'gnav-links', 'aria-label': 'Navigation' }, links()) : h('span', { class: 'spacer' }),
      h(
        'div',
        { class: 'gnav-end' },
        h('button', { class: 'gnav-account', type: 'button', 'aria-label': 'Mon compte', title: 'Mon compte', onClick: accountMenu }, icon('user')),
        menuButton,
      ),
    ),
  );

  // Local nav: appears once the large title has scrolled away,
  // keeping the page name and its main action one tap away.
  const lnavTitle = h('span', { class: 'lnav-title' });
  const lnavAction = h('button', { class: 'btn sm lnav-action', type: 'button', hidden: true, tabindex: '-1', onClick: () => primaryAction()?.click() });
  const lnav = h('div', { class: 'lnav', 'aria-hidden': 'true' }, h('div', { class: 'lnav-inner' }, lnavTitle, lnavAction));

  const el = h('div', { class: `shell ${role}` }, gnav, lnav, h('main', { class: 'main' }, slot), menu);
  shell = { role, el, slot, menu, menuButton, lnav, lnavTitle, lnavAction };
  return shell;
}

function toggleMenu(open = shell.menu.hidden) {
  if (!shell.menuButton) return;
  shell.menuButton.setAttribute('aria-expanded', String(open));
  document.documentElement.classList.toggle('menu-open', open);
  if (open) {
    shell.menu.hidden = false;
    requestAnimationFrame(() => shell.menu.classList.add('open'));
  } else if (!shell.menu.hidden) {
    shell.menu.classList.remove('open');
    setTimeout(() => {
      if (!shell.menu.classList.contains('open')) shell.menu.hidden = true;
    }, reducedMotion() ? 0 : 320);
  }
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && shell && !shell.menu.hidden) toggleMenu(false);
});

function setActive(path) {
  shell.el.querySelectorAll('a[data-path]').forEach((a) => {
    const on = a.dataset.path === path;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

// The page's main action: marked with data-lnav, or the header's filled button.
function primaryAction() {
  return shell.slot.querySelector('[data-lnav]') || shell.slot.querySelector('.page-header .btn:not(.secondary):not(.ghost)');
}

function updateLnav() {
  if (!shell) return;
  const h1 = shell.slot.querySelector('.page-header h1');
  const shown = !!h1 && h1.getBoundingClientRect().bottom < 0;
  shell.lnav.classList.toggle('shown', shown);
  shell.lnav.setAttribute('aria-hidden', String(!shown));
  if (h1 && shell.lnavTitle.textContent !== h1.textContent) shell.lnavTitle.textContent = h1.textContent;
  const action = primaryAction();
  shell.lnavAction.hidden = !action;
  shell.lnavAction.tabIndex = shown ? 0 : -1;
  if (action) shell.lnavAction.textContent = action.dataset.lnav || action.textContent;
}
let ticking = false;
window.addEventListener(
  'scroll',
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      updateLnav();
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
    updateLnav();
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
