import { h, flags, busy, toast, fmt } from './ui.js';
import { api } from './api.js';

// The photo is reduced on the phone before it leaves, to the size the model reads at most:
// the digits stay sharp, the upload stays short.
const MAX_SIDE = 1568;

export async function shrink(file) {
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

// Photos read by Claude are offered when the server has its key, never to the owner (read only).
export const photosOn = () => flags.ai && !flags.readonly;

// A camera button: the phone's camera (or its photos), the picture reduced, then onImage(base64).
// The button waits while it runs; an error becomes a toast. The file input lives outside the button's
// group, so the group's colours keep taking turns.
export function photoButton({ label, onImage, className = 'btn secondary meter-photo', text = null, camera = true }) {
  const pick = () => {
    const file = h('input', { type: 'file', accept: 'image/*', capture: camera ? 'environment' : null, hidden: true });
    file.addEventListener('change', () => {
      const photo = file.files?.[0];
      file.remove();
      if (photo) busy(btn, async () => onImage(await shrink(photo)));
    });
    file.addEventListener('cancel', () => file.remove());
    document.body.append(file);
    file.click();
  };
  const btn = h('button', { type: 'button', class: className, 'aria-label': text ? null : label, onClick: pick }, h('span', { class: 'png-icon png-camera', 'aria-hidden': 'true' }), text);
  return btn;
}

// The photo of a meter in a report: opens the picture (kept a week). An index typed differently
// from what Claude read shows the figure read beside it.
export function meterPhotoLink(id, read, index) {
  if (!id) return null;
  const typed = index != null && (read == null || Math.abs(read - index) > 0.001);
  return h(
    'a',
    { class: `photo-link${typed ? ' corrected' : ''}`, href: `/api/meter-photos/${id}`, target: '_blank', rel: 'noopener', 'aria-label': 'Photo du compteur' },
    h('span', { class: 'png-icon png-camera', 'aria-hidden': 'true' }),
    typed ? h('span', { class: 'photo-read' }, read == null ? 'illisible' : `lu ${fmt.number(read)}`) : null,
  );
}

// After a photo, the index field opens for a correction (photoId: the photo kept with it).
export function markRead(input, photoId) {
  input.dataset.read = '1';
  if (photoId) input.dataset.photoId = String(photoId);
  input.setAttribute('inputmode', 'decimal');
  input.closest('.meter-row')?.classList.remove('photo-only');
}

// A field with the camera beside it.
export function withPhoto(fieldEl, { label, onImage }) {
  if (!photosOn()) return fieldEl;
  return h('div', { class: 'meter-row' }, fieldEl, photoButton({ label, onImage }));
}

// A meter index field: the index comes from a photo, never typed first. The figure read lands in the
// field, which then opens for a correction if Claude misread; touching the empty field opens the camera.
// With the nozzle, the photo is kept a week and goes with the relief or closing (input.dataset.photoId),
// also when it could not be read (the index is then typed). `typed`: a correction afterwards, typed.
export function withMeterPhoto(fieldEl, { product, last, nozzleId, typed = false } = {}) {
  if (!photosOn()) return fieldEl;
  const input = fieldEl.querySelector('input');
  const filled = (index, photoId) => {
    markRead(input, photoId);
    if (index != null) input.value = String(index);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  };
  const btn = photoButton({
    label: `Photo du compteur${product ? ` ${product}` : ''}`,
    onImage: async (image) => {
      try {
        const { index, suspect, photoId } = await api.post('/meters/read', { image, mediaType: 'image/jpeg', product, last, nozzleId }, { timeout: 30000 });
        filled(index, photoId);
        if (suspect) toast(`À vérifier : ${fmt.number(index)}, dernier relevé ${fmt.number(last)}`, 'error');
      } catch (err) {
        if (err.data?.photoId || (!typed && err.status === 422)) filled(null, err.data?.photoId);
        throw err;
      }
    },
  });
  const row = h('div', { class: 'meter-row' }, fieldEl, btn);
  if (!typed) {
    row.classList.add('photo-only');
    input.setAttribute('inputmode', 'none');
    const locked = () => !input.dataset.read;
    input.addEventListener('beforeinput', (e) => locked() && e.preventDefault());
    input.addEventListener('keydown', (e) => locked() && /^(Arrow|Page)/.test(e.key) && e.preventDefault());
    input.addEventListener('click', () => locked() && btn.click());
  }
  return row;
}
