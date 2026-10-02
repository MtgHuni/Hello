import { api } from './api.js';
import { h, initials, errorState, toast, formDialog } from './ui.js';
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

// Each role gets its own navigation; the first entry is the home page.
const NAV = {
  manager: [
    ['', 'Tableau de bord', 'home', renderDashboard],
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

export function navigate(path) {
  location.hash = `#/${path}`;
}

async function boot() {
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
    title: 'Changer mon mot de passe',
    grid: false,
    fields: [
      { name: 'current', label: 'Mot de passe actuel', type: 'password', required: true, autocomplete: 'current-password' },
      { name: 'password', label: 'Nouveau mot de passe', type: 'password', required: true, autocomplete: 'new-password', hint: '8 caractères minimum' },
    ],
    onSubmit: (d) => api.post('/auth/password', d),
  });
  if (ok) toast('Mot de passe modifié.');
}

function route() {
  if (!state.user) return;
  const [section = '', id] = location.hash.replace(/^#\/?/, '').split('/');
  const nav = NAV[state.user.role];
  const entry = nav.find(([path]) => path === section) || nav[0];
  const detail = id ? DETAIL_ROUTES[state.user.role]?.[section] : null;
  const view = detail || entry[3];

  const content = h('div', { class: 'page' }, h('div', { class: 'loading' }, 'Chargement…'));
  root.replaceChildren(layout(nav, entry[0], content));
  window.scrollTo(0, 0);
  Promise.resolve(view(content, { id, state, navigate, refresh: route })).catch((err) => {
    content.replaceChildren(errorState(err));
  });
}

function brand() {
  return h('div', { class: 'brand' }, h('div', { class: 'brand-logo' }, icon('pump')), h('span', { class: 'brand-name' }, state.settings.stationName));
}

function accountButtons() {
  return [
    h('button', { class: 'btn ghost sm', title: 'Changer mon mot de passe', 'aria-label': 'Changer mon mot de passe', onClick: changePassword }, icon('settings')),
    h('button', { class: 'btn ghost sm', title: 'Se déconnecter', 'aria-label': 'Se déconnecter', onClick: logout }, icon('logout')),
  ];
}

function layout(nav, active, content) {
  const link = ([path, label, iconName]) => h('a', { href: `#/${path}`, class: path === active ? 'active' : '' }, icon(iconName), h('span', {}, label));
  const userMenu = h(
    'div',
    { class: 'user-chip' },
    h('div', { class: 'avatar' }, initials(state.user.name)),
    h('div', { style: 'min-width:0;flex:1' }, h('div', { class: 'small', style: 'font-weight:600' }, state.user.name), h('a', { href: '#', class: 'small', onClick: (e) => { e.preventDefault(); changePassword(); } }, 'Mot de passe')),
    h('button', { class: 'btn ghost sm', title: 'Se déconnecter', 'aria-label': 'Se déconnecter', onClick: logout }, icon('logout')),
  );

  if (state.user.role === 'manager') {
    return h(
      'div',
      { class: 'shell' },
      h('aside', { class: 'sidebar' }, brand(), h('nav', { class: 'nav' }, nav.map(link)), h('div', { class: 'sidebar-footer' }, userMenu)),
      h('main', { class: 'main' }, h('header', { class: 'topbar mobile-only' }, brand(), h('span', { class: 'spacer' }), ...accountButtons()), content),
      h('nav', { class: 'mobile-nav' }, nav.filter(([p]) => p !== 'pompe').map(link)),
    );
  }

  // Attendants and customers: a single column, built for the phone.
  content.classList.add('narrow');
  return h(
    'div',
    {},
    h('header', { class: 'topbar' }, brand(), h('span', { class: 'spacer' }), ...accountButtons()),
    h(
      'main',
      { class: 'simple-main' },
      nav.length > 1
        ? h('nav', { class: 'tabs' }, nav.map(([path, label]) => h('a', { href: `#/${path}`, class: path === active ? 'active' : '' }, label)))
        : null,
      content,
    ),
  );
}

window.addEventListener('hashchange', route);
window.addEventListener('auth:lost', () => {
  if (state.user) {
    state.user = null;
    toast('Votre session a expiré. Reconnectez-vous.', 'error');
    boot();
  }
});

boot();
