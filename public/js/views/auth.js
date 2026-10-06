import { flags } from '../ui.js';
import { api } from '../api.js';
import { h, field, readForm, setContent } from '../ui.js';
import { brandMark } from '../icons.js';

// Le film de la marque (rendu avec HyperFrames) : en boucle, sans son ;
// image fixe si l'appareil demande moins d'animations ou si la vidéo ne se charge pas.
function filmPanel() {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData;
  if (still) return h('div', { class: 'auth-film' });
  const video = h(
    'video',
    { class: 'auth-video', muted: true, playsinline: true, loop: true, preload: 'auto', poster: '/media/mtg-totem-poster.jpg', 'aria-hidden': 'true', tabindex: '-1' },
    h('source', { src: '/media/mtg-totem.webm', type: 'video/webm' }),
    h('source', { src: '/media/mtg-totem.mp4', type: 'video/mp4' }),
  );
  video.muted = true;
  // The poster is the panel's background: the video only fades in once it really plays,
  // so a blocked autoplay never leaves a black first frame on screen.
  video.addEventListener('playing', () => video.classList.add('is-playing'));
  video.addEventListener('pause', () => video.classList.remove('is-playing'));
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    video.autoplay = true;
    // Ask again once data is there: a play() before the panel is in the page can be dropped.
    video.addEventListener('canplay', () => video.play?.().catch(() => {}), { once: true });
  }
  return h('div', { class: 'auth-film' }, video);
}

function authForm({ title, lead, fields, submitLabel, onSubmit, wide, footer }) {
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
    filmPanel(),
    h(
      'div',
      { class: 'auth-pane' },
      h('div', { class: `auth-card ${wide ? 'wide' : ''}` }, brandMark(), h('h1', {}, title), h('p', { class: 'lead' }, lead), form, footer ? h('p', { class: 'auth-footer' }, footer) : null),
    ),
  );
}

export function renderLogin(root, stationName, onDone) {
  document.title = stationName;
  setContent(root, 
    authForm({
      title: 'Connexion',
      lead: `Accédez à ${stationName}.`,
      submitLabel: 'Se connecter',
      fields: [
        { name: 'login', label: 'Identifiant ou téléphone', required: true, autocomplete: 'username' },
        { name: 'password', label: 'Mot de passe', type: 'password', required: true, autocomplete: 'current-password' },
      ],
      onSubmit: async (d) => {
        await api.post('/auth/login', d);
        onDone();
      },
      footer: ['Nouveau client ? ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); renderRegister(root, stationName, onDone); } }, 'Créer mon compte')],
    }),
  );
  root.querySelector('input')?.focus();
}

// Customers sign up themselves (phone number = login), then start fill-ups from their phone.
export function renderRegister(root, stationName, onDone) {
  setContent(root, 
    authForm({
      title: 'Créer mon compte',
      lead: `Client de ${stationName}`,
      submitLabel: 'Créer mon compte',
      fields: [
        { name: 'name', label: 'Nom complet', required: true, autocomplete: 'name' },
        { name: 'phone', label: 'Téléphone', type: 'tel', required: true, autocomplete: 'tel', placeholder: '+243 …' },
        { name: 'password', label: 'Mot de passe', type: 'password', required: true, autocomplete: 'new-password' },
      ],
      onSubmit: async (d) => {
        await api.post('/register', d);
        onDone();
      },
      footer: ['Déjà un compte ? ', h('a', { href: '#', onClick: (e) => { e.preventDefault(); renderLogin(root, stationName, onDone); } }, 'Se connecter')],
    }),
  );
  root.querySelector('input')?.focus();
}

export function renderSetup(root, onDone) {
  setContent(root, 
    authForm({
      title: 'Bienvenue',
      lead: 'Configurons votre station.',
      submitLabel: 'Créer la station',
      wide: true,
      fields: [
        { name: 'stationName', label: 'Nom de la station', required: true, full: true, placeholder: 'Station du Centre' },
        { name: 'name', label: 'Votre nom', required: true, autocomplete: 'name' },
        { name: 'login', label: 'Identifiant de connexion', required: true, autocomplete: 'username' },
        { name: 'password', label: 'Mot de passe', type: 'password', required: true, autocomplete: 'new-password', full: true },
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
