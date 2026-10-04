// Minimal PDF writer for text reports: A4 pages, Helvetica and Helvetica-Bold
// (the standard fonts every reader has), WinAnsi encoding for French accents.
// No dependency; y is measured from the top of the page.

const PAGE_W = 595.28;
const PAGE_H = 841.89;

// Helvetica glyph widths (1/1000 em) for ASCII 32–126, from the standard AFM files.
const WIDTHS = {
  regular: [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ],
  bold: [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
  ],
};

// Characters of WinAnsi outside Latin-1, and their byte.
const WIN_ANSI = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‰': 0x89, 'Œ': 0x8c, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, 'œ': 0x9c, 'Ÿ': 0x9f };
const WIDE = { '…': 1000, '—': 1000, '‰': 1000, 'Œ': 1000, 'œ': 944, '«': 556, '»': 556, '€': 556 };

// Unicode → WinAnsi: narrow and plain no-break spaces become spaces, the minus sign a hyphen.
function normalize(text) {
  return String(text ?? '')
    .replace(/[   ]/g, ' ')
    .replace(/−/g, '-')
    .replace(/→/g, '->');
}

function byteOf(ch) {
  const code = ch.codePointAt(0);
  if (code < 128 || (code >= 0xa0 && code <= 0xff)) return code;
  return WIN_ANSI[ch] ?? 0x3f; // '?'
}

function charWidth(ch, bold) {
  const table = bold ? WIDTHS.bold : WIDTHS.regular;
  const code = ch.codePointAt(0);
  if (code >= 32 && code <= 126) return table[code - 32];
  if (WIDE[ch]) return WIDE[ch];
  const base = ch.normalize('NFD')[0].codePointAt(0); // é → e
  if (base >= 32 && base <= 126) return table[base - 32];
  return 556;
}

function textWidth(text, size, bold = false) {
  let w = 0;
  for (const ch of normalize(text)) w += charWidth(ch, bold);
  return (w * size) / 1000;
}

// Shortens text with an ellipsis so that it fits the given width.
function fit(text, maxWidth, size, bold = false) {
  let t = normalize(text);
  if (textWidth(t, size, bold) <= maxWidth) return t;
  while (t.length && textWidth(`${t}…`, size, bold) > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

// Splits text into lines no wider than maxWidth, breaking between words.
function wrap(text, maxWidth, size, bold = false) {
  const lines = [];
  let current = '';
  for (const word of normalize(text).split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && textWidth(next, size, bold) > maxWidth) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.map((l) => fit(l, maxWidth, size, bold));
}

function literal(text) {
  let out = '(';
  for (const ch of normalize(text)) {
    const b = byteOf(ch);
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += `\\${ch}`;
    else if (b < 32 || b > 126) out += `\\${b.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(b);
  }
  return `${out})`;
}

const rgb = (c) => c.map((v) => (v / 255).toFixed(3)).join(' ');

class Pdf {
  constructor({ title = '' } = {}) {
    this.title = title;
    this.pages = [];
    this.width = PAGE_W;
    this.height = PAGE_H;
    this.addPage();
  }

  addPage() {
    this.ops = [];
    this.pages.push(this.ops);
    return this;
  }

  // Draws on an earlier page, e.g. footers once the page count is known.
  usePage(index) {
    this.ops = this.pages[index];
    return this;
  }

  text(x, y, text, { size = 10, bold = false, color = [10, 10, 11], align = 'left' } = {}) {
    const t = normalize(text);
    let left = x;
    if (align === 'right') left = x - textWidth(t, size, bold);
    else if (align === 'center') left = x - textWidth(t, size, bold) / 2;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg ${left.toFixed(2)} ${(PAGE_H - y).toFixed(2)} Td ${literal(t)} Tj ET`);
    return this;
  }

  line(x1, y1, x2, y2, { color = [216, 216, 210], width = 0.6 } = {}) {
    this.ops.push(`${rgb(color)} RG ${width} w ${x1.toFixed(2)} ${(PAGE_H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_H - y2).toFixed(2)} l S`);
    return this;
  }

  rect(x, y, w, h, color) {
    this.ops.push(`${rgb(color)} rg ${x.toFixed(2)} ${(PAGE_H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    return this;
  }

  toBuffer() {
    const objects = [];
    const add = (body) => objects.push(body) && objects.length;
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add(''); // page tree, filled once the pages are numbered
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const info = add(`<< /Title ${literal(this.title)} /Producer (MTG Station) >>`);
    const kids = [];
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
      kids.push(
        add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`),
      );
    }
    objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(Buffer.byteLength(out, 'latin1'));
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}

module.exports = { Pdf, textWidth, fit, wrap };
