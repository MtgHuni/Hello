// A request gives up after 15 s: on a weak connection the screen answers instead of freezing.
const TIMEOUT = 15000;

async function request(method, url, body, { timeout = TIMEOUT } = {}) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeout);
  let res;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal: abort.signal,
    });
  } catch {
    const err = new Error('Connexion perdue. Vérifiez le réseau, puis réessayez.');
    err.code = 'network';
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 && !url.startsWith('/auth/')) {
    window.dispatchEvent(new Event('auth:lost'));
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erreur ${res.status}`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}, options) => request('POST', url, body, options),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
};
