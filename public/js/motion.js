// Mouvement des chiffres : les montants, litres et pourcentages « se comptent » à l'arrivée d'un écran.
// Un seul rAF partagé, 12 éléments au plus, rien quand l'utilisateur demande moins de mouvement.
// Le texte final est déjà dans le DOM : si le script échoue, la page reste juste.

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const NUMBER = /[-−+]?\d+(?:[   ]\d{3})*(?:,\d+)?/;
const SELECTOR = '.kpi .value, .tank-pct, .big-result .value, .status-figure';
const DURATION = 750;
const MAX = 12;

const easeOut = (t) => 1 - Math.pow(1 - t, 4);

function firstNumberNode(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (NUMBER.test(n.nodeValue)) return n;
  return null;
}

function prepare(el) {
  const node = firstNumberNode(el);
  if (!node) return null;
  const text = node.nodeValue;
  const match = text.match(NUMBER)[0];
  const clean = match.replace(/[   ]/g, '').replace('−', '-').replace(',', '.');
  const target = Number(clean);
  if (!Number.isFinite(target) || target === 0) return null;
  const decimals = (match.split(',')[1] || '').length;
  const format = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = match.trim().startsWith('+') ? '+' : '';
  const at = text.indexOf(match);
  const before = text.slice(0, at);
  const after = text.slice(at + match.length);
  return { node, target, render: (v) => `${before}${sign}${format.format(v).replace('-', '−')}${after}`, final: text };
}

export function enhance(root) {
  // Onglet masqué : requestAnimationFrame est suspendu, le texte final reste en place.
  if (reduced.matches || document.visibilityState === 'hidden') return;
  const items = [...root.querySelectorAll(SELECTOR)].slice(0, MAX).map(prepare).filter(Boolean);
  if (!items.length) return;
  const start = performance.now();
  for (const it of items) it.node.nodeValue = it.render(0);
  const tick = (now) => {
    const t = Math.min(1, (now - start) / DURATION);
    const k = easeOut(t);
    for (const it of items) it.node.nodeValue = t < 1 ? it.render(it.target * k) : it.final;
    if (t < 1 && document.visibilityState !== 'hidden') requestAnimationFrame(tick);
    else for (const it of items) it.node.nodeValue = it.final;
  };
  requestAnimationFrame(tick);
  // Filet de sécurité : si les images d'animation sont suspendues en route, le texte final est rétabli.
  setTimeout(() => {
    for (const it of items) it.node.nodeValue = it.final;
  }, DURATION + 250);
}
