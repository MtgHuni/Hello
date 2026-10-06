// The look of every mail: the station's night totem (black band, gasoil green and essence red
// stripe, yellow action slab) on a light page that every mail app shows the same way.
// Tables and inline styles only: that is what Gmail, Outlook and phone mail apps all read.
// Each mail is built from blocks; the same blocks give the plain-text version.

const C = {
  page: '#ecebe6',
  card: '#ffffff',
  night: '#0a0a0b',
  ink: '#1d1d20',
  muted: '#6b6a66',
  line: '#e6e5e0',
  yellow: '#ffc414',
  gasoil: '#23c46b',
  essence: '#f0313a',
  good: '#178a4a',
  bad: '#c8262d',
  warn: '#b45f06',
};
const DISPLAY = "'Barlow Condensed','Arial Narrow','Helvetica Neue',Arial,sans-serif";
const BODY = "Inter,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const LEVEL = { critical: C.bad, serious: C.warn, warning: C.warn, good: C.good, bad: C.bad };

function blockHtml(b) {
  if (b.p != null) return `<p style="margin:0 0 16px;font:16px/1.55 ${BODY};color:${C.ink}">${esc(b.p)}</p>`;
  if (b.amount) {
    const color = LEVEL[b.amount.level] || C.ink;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;border-collapse:separate;background:#f6f5f1;border-radius:10px"><tr><td style="padding:18px 20px">
      <div style="font:600 13px/1.3 ${BODY};color:${C.muted};text-transform:uppercase;letter-spacing:.06em">${esc(b.amount.label)}</div>
      <div style="font:700 40px/1.1 ${DISPLAY};color:${color};margin-top:6px">${esc(b.amount.value)}</div>
      ${b.amount.sub ? `<div style="font:14px/1.4 ${BODY};color:${C.muted};margin-top:4px">${esc(b.amount.sub)}</div>` : ''}
    </td></tr></table>`;
  }
  if (b.rows) {
    const rows = b.rows
      .filter(Boolean)
      .map(
        ([label, value, o = {}]) =>
          `<tr><td style="padding:10px 0;border-top:1px solid ${C.line};font:15px/1.4 ${BODY};color:${C.muted}">${esc(label)}</td>
           <td align="right" style="padding:10px 0 10px 12px;border-top:1px solid ${C.line};font:${o.bold ? 700 : 500} 15px/1.4 ${BODY};color:${LEVEL[o.level] || C.ink};white-space:nowrap">${esc(value)}</td></tr>`,
      )
      .join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;border-bottom:1px solid ${C.line}">${rows}</table>`;
  }
  if (b.list) {
    const items = b.list
      .map(
        (i) =>
          `<tr><td width="14" valign="top" style="padding:13px 0 0"><div style="width:8px;height:8px;border-radius:2px;background:${LEVEL[i.level] || C.muted}"></div></td>
           <td style="padding:8px 0;font:15px/1.45 ${BODY};color:${C.ink}">${esc(i.text)}</td></tr>`,
      )
      .join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse">${items}</table>`;
  }
  if (b.button) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px"><tr><td style="background:${C.yellow};border-radius:8px">
      <a href="${esc(b.button.url)}" style="display:inline-block;padding:14px 24px;font:700 16px/1.2 ${BODY};color:${C.night};text-decoration:none;border-radius:8px">${esc(b.button.label)}</a>
    </td></tr></table>`;
  }
  if (b.code) {
    return `<div style="margin:0 0 20px;padding:14px 18px;background:#f6f5f1;border-radius:10px;font:15px/1.7 ${BODY};color:${C.ink}">${b.code
      .map(([label, value]) => `${esc(label)} : <strong style="font-size:16px;letter-spacing:.02em">${esc(value)}</strong>`)
      .join('<br>')}</div>`;
  }
  if (b.note != null) return `<p style="margin:0 0 16px;font:14px/1.5 ${BODY};color:${C.muted}">${esc(b.note)}</p>`;
  return '';
}

function blockText(b) {
  if (b.p != null) return b.p;
  if (b.amount) return `${b.amount.label} : ${b.amount.value}${b.amount.sub ? ` (${b.amount.sub})` : ''}`;
  if (b.rows) return b.rows.filter(Boolean).map(([l, v]) => `${l} : ${v}`).join('\n');
  if (b.list) return b.list.map((i) => `- ${i.text}`).join('\n');
  if (b.button) return `${b.button.label} : ${b.button.url}`;
  if (b.code) return b.code.map(([l, v]) => `${l} : ${v}`).join('\n');
  if (b.note != null) return b.note;
  return '';
}

// mail: { eyebrow, title, preheader, blocks, unsubscribeUrl?, manageUrl? }
// station: { name, phone, appUrl }
function renderMail(mail, station) {
  const phone = station.phone ? station.phone.replace(/^\+243(\d{3})(\d{3})(\d{3})$/, '+243 $1 $2 $3') : '';
  const contact = phone ? `Pour toute question ou plus d’informations, contactez-nous au ${phone}.` : 'Pour toute question ou plus d’informations, contactez la station.';
  const links = [
    mail.unsubscribeUrl ? `<a href="${esc(mail.unsubscribeUrl)}" style="color:${C.muted};text-decoration:underline">Ne plus recevoir ces mails</a>` : null,
    mail.manageUrl ? `<a href="${esc(mail.manageUrl)}" style="color:${C.muted};text-decoration:underline">Gérer mes mails</a>` : null,
  ].filter(Boolean);
  const logo = station.appUrl ? `<img src="${esc(station.appUrl)}/media/mail-logo.png" width="28" height="28" alt="" style="display:block;border:0">` : '';

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(mail.title)}</title></head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(mail.preheader || mail.title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border-collapse:separate;background:${C.card};border-radius:14px;overflow:hidden">
    <tr><td style="background:${C.night};padding:18px 24px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        ${logo ? `<td style="padding-right:12px">${logo}</td>` : ''}
        <td style="font:800 22px/1 ${DISPLAY};letter-spacing:.04em;text-transform:uppercase;color:#f5f4ef">${esc(station.name)}</td>
      </tr></table>
    </td></tr>
    <tr><td style="font-size:0;line-height:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="50%" height="6" style="background:${C.gasoil};font-size:0;line-height:0">&nbsp;</td>
      <td width="50%" height="6" style="background:${C.essence};font-size:0;line-height:0">&nbsp;</td>
    </tr></table></td></tr>
    <tr><td style="padding:30px 28px 12px">
      ${mail.eyebrow ? `<div style="font:700 12px/1.3 ${BODY};letter-spacing:.1em;text-transform:uppercase;color:${C.muted};margin-bottom:8px">${esc(mail.eyebrow)}</div>` : ''}
      <h1 style="margin:0 0 18px;font:700 30px/1.1 ${DISPLAY};color:${C.night}">${esc(mail.title)}</h1>
      ${mail.blocks.map(blockHtml).join('\n')}
    </td></tr>
    <tr><td style="padding:18px 28px 26px;border-top:1px solid ${C.line}">
      <p style="margin:0 0 6px;font:13px/1.5 ${BODY};color:${C.muted}">${esc(contact)}</p>
      <p style="margin:0;font:13px/1.5 ${BODY};color:${C.muted}">${esc(station.name)} · Goma${links.length ? ` · ${links.join(' · ')}` : ''}</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [
    station.name.toUpperCase(),
    '',
    mail.title,
    '',
    ...mail.blocks.map(blockText).filter(Boolean).flatMap((t) => [t, '']),
    '—',
    contact,
    mail.unsubscribeUrl ? `Ne plus recevoir ces mails : ${mail.unsubscribeUrl}` : null,
    mail.manageUrl ? `Gérer mes mails : ${mail.manageUrl}` : null,
  ]
    .filter((l) => l != null)
    .join('\n');

  return { html, text };
}

module.exports = { renderMail };
