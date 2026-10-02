import { api } from '../api.js';
import { h, field, readForm } from '../ui.js';
import { icon } from '../icons.js';

function authForm({ title, lead, fields, submitLabel, onSubmit, wide }) {
  const error = h('p', { class: 'form-error', hidden: true, role: 'alert' });
  const submit = h('button', { class: 'btn large block', type: 'submit' }, submitLabel);
  const form = h(
    'form',
    { class: 'stack' },
    h('div', { class: wide ? 'form-grid' : 'stack' }, fields.map(field)),
    error,
    submit,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    error.hidden = true;
    try {
      await onSubmit(readForm(form, fields));
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
    }
  });
  return h(
    'div',
    { class: 'auth' },
    h('div', { class: `auth-card glass ${wide ? 'wide' : ''}` }, h('div', { class: 'app-icon lg' }, icon('pump')), h('h1', {}, title), h('p', { class: 'lead' }, lead), form),
  );
}

export function renderLogin(root, stationName, onDone) {
  document.title = stationName;
  root.replaceChildren(
    authForm({
      title: stationName,
      lead: 'Connectez-vous pour continuer.',
      submitLabel: 'Se connecter',
      fields: [
        { name: 'login', label: 'Identifiant', required: true, autocomplete: 'username' },
        { name: 'password', label: 'Mot de passe', type: 'password', required: true, autocomplete: 'current-password' },
      ],
      onSubmit: async (d) => {
        await api.post('/auth/login', d);
        onDone();
      },
    }),
  );
  root.querySelector('input')?.focus();
}

export function renderSetup(root, onDone) {
  root.replaceChildren(
    authForm({
      title: 'Bienvenue',
      lead: 'Configurons votre station. Vous pourrez tout modifier ensuite dans les réglages.',
      submitLabel: 'Créer la station',
      wide: true,
      fields: [
        { name: 'stationName', label: 'Nom de la station', required: true, full: true, placeholder: 'Station du Centre' },
        { name: 'name', label: 'Votre nom', required: true, autocomplete: 'name' },
        { name: 'login', label: 'Identifiant de connexion', required: true, autocomplete: 'username' },
        { name: 'password', label: 'Mot de passe', type: 'password', required: true, autocomplete: 'new-password', hint: '8 caractères minimum', full: true },
        { name: 'dieselPrice', label: 'Prix du gasoil ($/L)', type: 'number', step: '0.001', min: '0', required: true },
        { name: 'petrolPrice', label: "Prix de l'essence ($/L)", type: 'number', step: '0.001', min: '0', required: true },
      ],
      onSubmit: async (d) => {
        await api.post('/setup', d);
        onDone();
      },
    }),
  );
}
