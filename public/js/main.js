import { flags } from './ui.js';
import { api } from './api.js';
import { h, errorState, toast, formDialog, actionSheet, openDialog, spinner, initials, applyTheme, toggleTheme, themeButton } from './ui.js';
import { icon, brandMark } from './icons.js';
import { enhance } from './motion.js';
import { renderLogin, renderSetup } from './views/auth.js';
import { renderDashboard } from './views/dashboard.js';
import { renderShifts, renderShiftDetail } from './views/shifts.js';
import { renderAttendant, renderMyShifts } from './views/attendant.js';
import { renderTanks } from './views/tanks.js';
import { renderCustomers, renderCustomerDetail } from './views/customers.js';
import { renderReports } from './views/reports.js';
import { renderSettings } from './views/settings.js';
import { renderJournal } from './views/journal.js';
import { renderAccount } from './views/account.js';
import { renderExpenses } from './views/expenses.js';
import { renderCashbook } from './views/cashbook.js';

const root = document.getElementById('app');
export const state = { user: null, settings: null };

// [path, label, icon, view, short label for the global nav]
const NAV = {
  manager: [
    ['', 'Tableau de bord', 'home', renderDashboard, 'Accueil'],
    ['postes', 'Postes', 'shifts', renderShifts],
    ['pompe', 'Mon poste', 'pump', renderAttendant],
    ['caisse', 'Caisse', 'cash', renderCashbook],
    ['clients', 'Clients', 'users', renderCustomers],
    ['depenses', 'Dépenses', 'wallet', renderExpenses],
    ['cuves', 'Cuves', 'tank', renderTanks],
    ['rapports', 'Rapports', 'chart', renderReports],
    ['reglages', 'Réglages', 'settings', renderSettings],
  ],
  attendant: [
    ['', 'Mon poste', 'pump', renderAttendant],
    ['historique', 'Historique', 'shifts', renderMyShifts],
  ],
  customer: [['', 'Mon compte', 'user', renderAccount]],
};
// The owner (actionnaire): the manager's screens, to read, but the pump and the settings.
NAV.owner = NAV.manager.filter(([path]) => !['pompe', 'reglages'].includes(path));

const DETAIL_ROUTES = {
  manager: { postes: renderShiftDetail, clients: renderCustomerDetail, reglages: renderJournal },
  attendant: { historique: renderShiftDetail },
};
DETAIL_ROUTES.owner = { postes: renderShiftDetail, clients: renderCustomerDetail };

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
    flags.combos = setup.combosEnabled !== false;
    if (setup.needsSetup) return renderSetup(root, boot);
    const me = await api.get('/auth/me').catch(() => null);
    if (!me) return renderLogin(root, setup.stationName, boot);
    state.user = me.user;
    state.settings = me.settings;
    flags.combos = me.settings.combosEnabled !== false;
    flags.readonly = me.user.role === 'owner';
    flags.admin = !!me.user.admin;
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
      { name: 'password', label: 'Nouveau mot de passe', type: 'password', required: true, autocomplete: 'new-password' },
    ],
    onSubmit: (d) => api.post('/auth/password', d),
  });
  if (ok) toast('Mot de passe modifié');
}

// Mode nuit (par défaut) ou mode jour pour la pompe en plein soleil ; mémorisé sur l'appareil.
try {
  applyTheme(localStorage.getItem('theme'));
} catch {
  /* stockage indisponible : mode nuit */
}

function accountMenu() {
  const actions = [{ label: document.documentElement.dataset.theme === 'light' ? 'Passer en mode nuit' : 'Passer en mode jour (plein soleil)', onClick: toggleTheme }, { label: 'Changer le mot de passe', onClick: changePassword }];
  actions.push({ label: 'Se déconnecter', destructive: true, onClick: logout });
  actionSheet({ title: `${state.user.name} · ${state.settings.stationName}`, actions });
}

// ---------- Persistent shell: side rail on wide screens, top bar + bottom tabs on phones ----------

const ROLE_LABEL = { manager: 'Gérant', attendant: 'Pompiste', customer: 'Client', owner: 'Actionnaire' };
// The admin is a manager with the settings and the cash book.
const roleLabel = () => (state.user.admin ? 'Administrateur' : ROLE_LABEL[state.user.role]);
// On phones the tab bar keeps four destinations; the others sit behind « Plus ».
const TAB_MAX = 4;

function buildShell() {
  const role = state.user.role;
  const nav = NAV[role];
  const slot = h('div', { class: 'page-slot' });
  const link = ([path, label, iconName, , short], useShort) =>
    h('a', { href: `#/${path}`, 'data-path': path }, icon(iconName), h('span', {}, useShort ? short || label : label));

  const side = h(
    'aside',
    { class: 'side' },
    h('a', { class: 'side-brand', href: '#/', 'aria-label': `${state.settings.stationName}, accueil` }, brandMark(), h('span', {}, state.settings.stationName)),
    nav.length > 1 ? h('nav', { class: 'side-nav', 'aria-label': 'Navigation' }, nav.map((n) => link(n, false))) : h('div', { class: 'spacer' }),
    h(
      'div',
      { class: 'side-account' },
      h(
        'button',
        { class: 'side-foot', type: 'button', 'aria-label': 'Mon compte', onClick: accountMenu },
        h('span', { class: 'avatar' }, initials(state.user.name)),
        h('span', { class: 'who' }, h('strong', {}, state.user.name), h('span', {}, roleLabel())),
        icon('more'),
      ),
      themeButton(),
    ),
  );

  const topTitle = h('span', { class: 'topbar-title' }, state.settings.stationName);
  const topbar = h(
    'header',
    { class: 'topbar' },
    h('a', { class: 'topbar-brand', href: '#/', 'aria-label': `${state.settings.stationName}, accueil` }, brandMark()),
    topTitle,
    themeButton(),
    h('button', { class: 'topbar-account', type: 'button', 'aria-label': 'Mon compte', onClick: accountMenu }, h('span', { class: 'avatar' }, initials(state.user.name))),
  );

  const overflow = nav.length > TAB_MAX + 1;
  const tabs = overflow ? nav.slice(0, TAB_MAX) : nav;
  const rest = overflow ? nav.slice(TAB_MAX) : [];
  const more = rest.length
    ? h(
        'button',
        {
          class: 'tab-more',
          type: 'button',
          onClick: openNavDrawer,
        },
        icon('more'),
        h('span', {}, 'Plus'),
      )
    : null;
  const tabbar = nav.length > 1 ? h('nav', { class: 'tabbar', 'aria-label': 'Navigation', style: `--n:${tabs.length + (more ? 1 : 0)}` }, tabs.map((n) => link(n, true)), more) : null;

  const el = h('div', { class: `shell ${role} ${tabbar ? 'has-tabs' : ''}` }, side, h('div', { class: 'shell-main' }, topbar, h('main', { class: 'main' }, slot)), tabbar);
  shell = { role, el, slot, topTitle, more, rest: rest.map(([path]) => path) };
  return shell;
}

// « Plus » on a phone: every section, those of the tab bar included, in a drawer from the side
// built like the side rail of wide screens.
function openNavDrawer() {
  const nav = NAV[state.user.role];
  const section = location.hash.replace(/^#\/?/, '').split('/')[0];
  const current = (nav.find(([path]) => path === section) || nav[0])[0];
  openDialog(
    (close) => {
      const go = (path) => (e) => {
        e.preventDefault();
        close();
        navigate(path);
      };
      return h(
        'div',
        { class: 'nav-drawer', role: 'navigation', 'aria-label': 'Toutes les rubriques' },
        h(
          'div',
          { class: 'nav-drawer-head' },
          h('a', { class: 'side-brand', href: '#/', onClick: go('') }, brandMark(), h('span', {}, state.settings.stationName)),
          h('button', { class: 'circle-btn', type: 'button', 'aria-label': 'Fermer', onClick: close }, icon('close')),
        ),
        h(
          'nav',
          { class: 'side-nav' },
          nav.map(([path, label, iconName]) =>
            h('a', { href: `#/${path}`, class: path === current ? 'active' : '', 'aria-current': path === current ? 'page' : null, onClick: go(path) }, icon(iconName), h('span', {}, label)),
          ),
        ),
        h(
          'button',
          { class: 'side-foot', type: 'button', 'aria-label': 'Mon compte', onClick: () => (close(), accountMenu()) },
          h('span', { class: 'avatar' }, initials(state.user.name)),
          h('span', { class: 'who' }, h('strong', {}, state.user.name), h('span', {}, roleLabel())),
          icon('more'),
        ),
      );
    },
    { kind: 'nav' },
  );
}

function setActive(path, label) {
  shell.el.querySelectorAll('a[data-path]').forEach((a) => {
    const on = a.dataset.path === path;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  shell.more?.classList.toggle('active', shell.rest.includes(path));
  shell.topTitle.textContent = NAV[shell.role].length > 1 ? label : state.settings.stationName;
}

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
  const [section = '', id, sub] = location.hash.replace(/^#\/?/, '').split('/');
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
  setActive(entry[0], entry[1]);

  const token = ++routeToken;
  const page = h('div', { class: `page ${['manager', 'owner'].includes(role) ? '' : 'narrow'}` });
  const slow = setTimeout(() => {
    if (token === routeToken) shell.slot.replaceChildren(h('div', { class: 'loading' }, spinner()));
  }, 300);
  try {
    await view(page, { id, sub, state, navigate, refresh: route });
  } catch (err) {
    page.replaceChildren(errorState(err, () => route()));
  }
  clearTimeout(slow);
  if (token !== routeToken) return; // a newer navigation won

  swap(() => {
    shell.slot.replaceChildren(page);
    window.scrollTo(0, 0);
    enhance(page);
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
