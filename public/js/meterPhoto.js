import { h, flags, busy, toast, fmt } from './ui.js';
import { api } from './api.js';

// The photo is reduced on the phone before it leaves, to the size the model reads at most:
// the digits stay sharp, the upload stays short.
const MAX_SIDE = 1568;

async function shrink(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  const url = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return String(url).split(',')[1];
}

// A meter index field with the camera beside it: the photo is read by the server and the figure
// lands in the field, for the attendant to check before saving. Without the reader (no key on the
// server) or for the owner, the field stays alone.
export function withMeterPhoto(fieldEl, { product, last } = {}) {
  if (!flags.meterReader || flags.readonly) return fieldEl;
  const input = fieldEl.querySelector('input');
  const file = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const btn = h(
    'button',
    { type: 'button', class: 'btn secondary meter-photo', 'aria-label': `Photo du compteur${product ? ` ${product}` : ''}`, onClick: () => file.click() },
    h('span', { class: 'png-icon png-camera', 'aria-hidden': 'true' }),
  );
  file.addEventListener('change', () => {
    const photo = file.files?.[0];
    file.value = '';
    if (!photo) return;
    busy(btn, async () => {
      const { index, suspect } = await api.post('/meters/read', { image: await shrink(photo), mediaType: 'image/jpeg', product, last }, { timeout: 30000 });
      input.value = String(index);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      if (suspect) toast(`À vérifier : ${fmt.number(index)}, dernier relevé ${fmt.number(last)}`, 'error');
    });
  });
  return h('div', { class: 'meter-row' }, fieldEl, btn, file);
}
