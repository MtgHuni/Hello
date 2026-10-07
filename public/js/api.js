// A request gives up after 15 s: on a weak connection the screen answers instead of freezing.
const TIMEOUT = 15000;

// ---------- Without network ----------
// The attendant's screen is kept on the phone (its last answers below), and the entries made
// without network (credit, payment, mobile money, expense, pump test) wait in the outbox,
// sent in order as soon as the server answers again. Their clientRef makes a resend harmless.
export const net = { offline: false, lastOk: Date.now(), user: null };
const KEEP = [/^\/setup$/, /^\/auth\/me$/, /^\/shifts\/state$/, /^\/shifts\/remarks\/unread$/, /^\/customers\?form=1$/, /^\/pumps$/];
const OUTBOX = 'outbox';
const store = {
  get: (key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or blocked: not kept */
    }
  },
};
const changed = () => window.dispatchEvent(new Event('net:change'));
function online(yes) {
  if (yes) net.lastOk = Date.now();
  if (net.offline === !yes) return;
  net.offline = !yes;
  changed();
  if (yes) setTimeout(flush, 0);
}

// The entries of the person signed in on this phone, still to send.
export const pending = () => (store.get(OUTBOX) || []).filter((x) => x.user === net.user);
const drop = (id) => {
  store.set(OUTBOX, (store.get(OUTBOX) || []).filter((x) => x.id !== id));
  changed();
};

// Who is signed in: the kept answers belong to them (another person on the phone starts empty).
export function setUser(id) {
  if (store.get('cache-user') !== id) forgetCache(['cache:/setup', 'cache:/auth/me']); // just fetched for them
  store.set('cache-user', id);
  net.user = id;
  changed();
  flush();
}
export function forgetCache(keep = []) {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('cache:') && !keep.includes(key)) localStorage.removeItem(key);
  } catch {
    /* nothing kept */
  }
}

async function request(method, url, body, { timeout = TIMEOUT, queue } = {}) {
  let res;
  try {
    if (navigator.onLine === false) throw new Error('offline');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeout);
    try {
      res = await fetch(`/api${url}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
        signal: abort.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    online(false);
    const kept = method === 'GET' && KEEP.some((re) => re.test(url)) ? store.get(`cache:${url}`) : null;
    if (kept) return kept;
    // An entry from the attendant's forms: kept on the phone, sent when the network is back.
    if (queue) {
      store.set(OUTBOX, [...(store.get(OUTBOX) || []), { id: crypto.randomUUID?.() || String(Math.random()), user: net.user, url, body, label: queue, at: Date.now(), tries: 0 }]);
      changed();
      return { queued: true };
    }
    const err = new Error('Connexion perdue. Vérifiez le réseau, puis réessayez.');
    err.code = 'network';
    throw err;
  }
  online(true);
  if (res.status === 401 && !url.startsWith('/auth/')) {
    window.dispatchEvent(new Event('auth:lost'));
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erreur ${res.status}`);
    err.status = res.status;
    err.code = data.code;
    err.data = data;
    throw err;
  }
  if (method === 'GET' && KEEP.some((re) => re.test(url))) store.set(`cache:${url}`, data);
  return data;
}

// Sends the outbox in order. An entry the server refuses (the customer still owes a credit, the
// shift is closed…) leaves it and is reported (`outbox:sent`); one the server could not take yet stays.
let flushing = false;
export async function flush() {
  if (flushing || !pending().length) return;
  flushing = true;
  changed();
  const sent = [];
  const refused = [];
  try {
    for (let item = pending()[0]; item; item = pending()[0]) {
      try {
        await request('POST', item.url, item.body);
        drop(item.id);
        sent.push(item);
      } catch (err) {
        if (err.code === 'network' || err.status === 401 || (err.status >= 500 && item.tries < 4)) {
          if (err.status >= 500) store.set(OUTBOX, (store.get(OUTBOX) || []).map((x) => (x.id === item.id ? { ...x, tries: x.tries + 1 } : x)));
          break;
        }
        drop(item.id);
        refused.push({ ...item, error: err.message });
      }
    }
  } finally {
    flushing = false;
    changed();
  }
  if (sent.length || refused.length) window.dispatchEvent(new CustomEvent('outbox:sent', { detail: { sent, refused } }));
}
export const isFlushing = () => flushing;
window.addEventListener('online', () => flush());
setInterval(() => pending().length && flush(), 20000);

export const api = {
  get: (url) => request('GET', url),
  // `queue`: the entry's label; without network it waits in the outbox and { queued: true } comes back.
  post: (url, body = {}, options) => request('POST', url, body, options),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
};
