// The look of every mail, as the big senders do it: the text without any page colour (the mail
// app's own, light or dark); only the header (the night band edge to edge, the MTG Station logo as a
// link to the site, gasoil and essence stripe) and the buttons are filled.
// Tables and inline styles only: that is what Gmail, Outlook and phone mail apps all read.
// Each mail is built from blocks; the same blocks give the plain-text version.

const C = {
  night: '#0a0a0b',
  muted: '#8a8984', // reads on a white and on a black mail app
  line: '#cfcec9',
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
  if (b.p != null) return `<p style="margin:0 0 16px;font:16px/1.55 ${BODY};">${esc(b.p)}</p>`;
  if (b.amount) {
    const color = LEVEL[b.amount.level];
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="rule" style="margin:4px 0 22px;border-collapse:collapse;border-top:1px solid ${C.line}"><tr><td style="padding:16px 0 0">
      <div style="font:600 13px/1.3 ${BODY};color:${C.muted};text-transform:uppercase;letter-spacing:.06em">${esc(b.amount.label)}</div>
      <div style="font:700 40px/1.1 ${DISPLAY};${color ? `color:${color};` : ''}margin-top:6px">${esc(b.amount.value)}</div>
      ${b.amount.sub ? `<div style="font:14px/1.4 ${BODY};color:${C.muted};margin-top:4px">${esc(b.amount.sub)}</div>` : ''}
    </td></tr></table>`;
  }
  if (b.rows) {
    const rows = b.rows
      .filter(Boolean)
      .map(
        ([label, value, o = {}]) =>
          `<tr><td class="rule" style="padding:10px 0;border-top:1px solid ${C.line};font:15px/1.4 ${BODY};color:${C.muted}">${esc(label)}</td>
           <td align="right" class="rule" style="padding:10px 0 10px 12px;border-top:1px solid ${C.line};font:${o.bold ? 700 : 500} 15px/1.4 ${BODY};${LEVEL[o.level] ? `color:${LEVEL[o.level]};` : ''}white-space:nowrap">${esc(value)}</td></tr>`,
      )
      .join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="rule" style="margin:0 0 20px;border-collapse:collapse;border-bottom:1px solid ${C.line}">${rows}</table>`;
  }
  if (b.list) {
    const items = b.list
      .map(
        (i) =>
          `<tr><td width="14" valign="top" style="padding:13px 0 0"><div style="width:8px;height:8px;border-radius:2px;background:${LEVEL[i.level] || C.muted}"></div></td>
           <td style="padding:8px 0;font:15px/1.45 ${BODY};">${esc(i.text)}</td></tr>`,
      )
      .join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse">${items}</table>`;
  }
  if (b.button) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td class="btn" style="background:${C.night};border-radius:10px">
      <a href="${esc(b.button.url)}" style="display:inline-block;padding:15px 26px;font:600 16px/1.2 ${BODY};color:#ffffff;text-decoration:none;border-radius:10px" class="btn-a">${esc(b.button.label)}</a>
    </td></tr></table>`;
  }
  if (b.code) {
    return `<div style="margin:0 0 20px;font:15px/1.8 ${BODY};">${b.code
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
  // The MTG Station logo (public/media/mail-logo.png, drawn at twice its size), a link to the site;
  // its name if images are off.
  const logoImg = `<img src="${esc(station.appUrl)}/media/mail-logo.png" width="104" height="61" alt="${esc(station.name)}" style="display:block;border:0;font:800 22px/1 ${DISPLAY};letter-spacing:.04em;text-transform:uppercase;color:#f5f4ef">`;
  const logo = station.appUrl
    ? `<a href="${esc(station.appUrl)}" style="display:inline-block;text-decoration:none">${logoImg}</a>`
    : `<span style="font:800 22px/1 ${DISPLAY};letter-spacing:.04em;text-transform:uppercase;color:#f5f4ef">${esc(station.name)}</span>`;
  // SMS, WhatsApp and call (public/media/mail-*.png, from pngegg.com), black, white in a dark mail app.
  const tel = (station.phone || '').replace(/[^\d+]/g, '');
  let wa = tel.replace(/\D/g, '');
  if (wa.startsWith('00')) wa = wa.slice(2);
  if (wa.startsWith('0')) wa = `243${wa.slice(1)}`;
  else if (wa.length === 9) wa = `243${wa}`;
  const icon = (href, file, label) =>
    `<td style="padding:0 20px 0 0"><a href="${esc(href)}" style="text-decoration:none"><img class="ico" src="${esc(station.appUrl)}/media/${file}.png" width="30" height="30" alt="${label}" style="display:block;border:0;font:600 12px/30px ${BODY};color:${C.muted}"></a></td>`;
  const icons =
    tel && station.appUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0 18px"><tr>${icon(`sms:${tel}`, 'mail-sms', 'SMS')}${wa.length >= 11 ? icon(`https://wa.me/${wa}`, 'mail-whatsapp', 'WhatsApp') : ''}${icon(`tel:${tel}`, 'mail-appel', 'Appeler')}</tr></table>`
      : '';

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(mail.title)}</title>
<style>@media (prefers-color-scheme: dark) { .btn { background:#f5f4ef !important } .btn-a { color:#0a0a0b !important } .rule { border-color:#333336 !important } .ico { filter:invert(1) } }</style></head>
<body style="margin:0;padding:0">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(mail.preheader || mail.title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="background:${C.night};padding:22px 20px 20px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td>${logo}</td></tr></table>
  </td></tr>
  <tr><td style="font-size:0;line-height:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="50%" height="5" style="background:${C.gasoil};font-size:0;line-height:0">&nbsp;</td>
    <td width="50%" height="5" style="background:${C.essence};font-size:0;line-height:0">&nbsp;</td>
  </tr></table></td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:0 20px 36px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:34px 0 6px">
      <h1 style="margin:0 0 20px;font:700 30px/1.1 ${DISPLAY}">${esc(mail.title)}</h1>
      ${mail.blocks.map(blockHtml).join('\n')}
    </td></tr>
    <tr><td class="rule" style="padding:22px 0 0;border-top:1px solid ${C.line}">
      <p style="margin:0;font:14px/1.5 ${BODY};">${esc(icons ? 'Pour toute question ou plus d’informations, contactez-nous' : contact)}</p>
      ${icons}
      <p style="margin:${icons ? 0 : '10px'} 0 0;font:12px/1.6 ${BODY};color:${C.muted}">${esc(station.name)} · Goma${links.length ? `<br>${links.join(' · ')}` : ''}</p>
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
