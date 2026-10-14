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
    { class: 'auth-video', muted: true, playsinline: true, loop: true, preload: 'auto', poster: '/media/mtg-totem-poster.jpg?v=mtg', 'aria-hidden': 'true', tabindex: '-1' },
    h('source', { src: '/media/mtg-totem.webm?v=mtg', type: 'video/webm' }),
    h('source', { src: '/media/mtg-totem.mp4?v=mtg', type: 'video/mp4' }),
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

function authForm({ title, lead, fields, submitLabel, onSubmit, wide, footer, below }) {
  const error = h('p', { class: 'form-error', hidden: true, role: 'alert' });
  const submit = h('button', { class: 'btn large block', type: 'submit' }, submitLabel);
  const form = h(
    'form',
    { class: 'stack' },
    h('div', { class: wide ? 'form-grid' : 'stack' }, fields.map(field)),
    below || null,
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
  return authFrame(h('div', { class: `auth-card ${wide ? 'wide' : ''}` }, brandMark(), h('h1', {}, title), h('p', { class: 'lead' }, lead), form, footer ? h('p', { class: 'auth-footer' }, footer) : null));
}

const authFrame = (card) => h('div', { class: 'auth' }, filmPanel(), h('div', { class: 'auth-pane' }, card));

// A screen with a message and one way on (link sent, link expired).
function authMessage({ title, lead, action }) {
  return authFrame(h('div', { class: 'auth-card' }, brandMark(), h('h1', {}, title), h('p', { class: 'lead' }, lead), action));
}

const backToLogin = (root, stationName, onDone, label = 'Retour à la connexion') =>
  h('a', { href: '#', class: 'back-link', onClick: (e) => (e.preventDefault(), history.replaceState(null, '', '/'), renderLogin(root, stationName, onDone)) }, label);

// « Mot de passe oublié » : a link by mail, to the account's confirmed address.
export function renderForgot(root, stationName, onDone) {
  setContent(
    root,
    authForm({
      title: 'Mot de passe oublié',
      lead: stationName,
      submitLabel: 'Recevoir un lien',
      fields: [{ name: 'login', label: 'Identifiant, téléphone ou e-mail', required: true, autocomplete: 'username' }],
      onSubmit: async (d) => {
        await api.post('/auth/forgot', d);
        setContent(
          root,
          authMessage({
            title: 'Vérifiez vos e-mails',
            lead: 'Si ce compte a une adresse e-mail confirmée, un lien vient d’y être envoyé. Il est valable une heure.',
            action: h('p', { class: 'auth-footer' }, backToLogin(root, stationName, onDone)),
          }),
        );
      },
      footer: backToLogin(root, stationName, onDone),
    }),
  );
  root.querySelector('input')?.focus();
}

// The link from the mail: a new password, then the app.
export async function renderReset(root, stationName, token, onDone) {
  const { valid } = await api.get(`/auth/reset/${encodeURIComponent(token)}`).catch(() => ({ valid: false }));
  if (!valid) {
    return setContent(
      root,
      authMessage({
        title: 'Lien expiré',
        lead: 'Ce lien a déjà servi ou date de plus d’une heure.',
        action: h(
          'div',
          { class: 'stack' },
          h('button', { class: 'btn large block', type: 'button', onClick: () => (history.replaceState(null, '', '/'), renderForgot(root, stationName, onDone)) }, 'Recevoir un nouveau lien'),
          h('p', { class: 'auth-footer' }, backToLogin(root, stationName, onDone)),
        ),
      }),
    );
  }
  setContent(
    root,
    authForm({
      title: 'Nouveau mot de passe',
      lead: stationName,
      submitLabel: 'Enregistrer et se connecter',
      fields: [
        { name: 'password', label: 'Nouveau mot de passe', type: 'password', required: true, autocomplete: 'new-password' },
        { name: 'confirm', label: 'Le même, encore une fois', type: 'password', required: true, autocomplete: 'new-password' },
      ],
      onSubmit: async (d) => {
        if (d.password !== d.confirm) throw new Error('Les deux mots de passe ne sont pas les mêmes.');
        await api.post('/auth/reset', { token, password: d.password });
        history.replaceState(null, '', '/');
        onDone();
      },
      footer: backToLogin(root, stationName, onDone),
    }),
  );
  root.querySelector('input')?.focus();
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
      below: h('a', { class: 'auth-forgot', href: '#', onClick: (e) => (e.preventDefault(), renderForgot(root, stationName, onDone)) }, 'Mot de passe oublié ?'),
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
