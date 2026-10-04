// Layout shared by the PDF reports (shift, period, customer statement): A4 page,
// brand header, ruled sections, key/value lines, tables that continue across pages
// with their column heads, and page footers once the page count is known.
const { Pdf, fit, wrap } = require('./pdf');

const TZ = 'Africa/Lubumbashi';
const INK = [10, 10, 11];
const GREY = [105, 105, 99];
const RULE = [214, 214, 208];
const GASOIL = [35, 196, 107];
const ESSENCE = [240, 49, 58];
const GOOD = [18, 128, 66];
const BAD = [196, 28, 38];

// SQLite timestamps are UTC 'YYYY-MM-DD HH:MM:SS'; 'YYYY-MM-DD' alone is a local day.
const toDate = (s) => (s instanceof Date ? s : new Date(String(s).length === 10 ? `${s}T12:00:00Z` : `${String(s).replace(' ', 'T')}Z`));
const fmt = {
  money: (n) => `${(Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`,
  signed: (n) => `${n > 0 ? '+' : ''}${fmt.money(n)}`,
  number: (n) => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 })),
  liters: (n) => `${fmt.number(n || 0)} L`,
  price: (n) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
  date: (s) => (s ? toDate(s).toLocaleDateString('fr-FR', { timeZone: TZ }) : '—'),
  dateTime: (s) => (s ? toDate(s).toLocaleString('fr-FR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }) : '—'),
  time: (s) => (s ? toDate(s).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—'),
};

class Report {
  constructor({ title, stationName, heading, subtitle, status, now = new Date() }) {
    this.pdf = new Pdf({ title: `${title} — ${stationName}` });
    this.L = 42;
    this.R = this.pdf.width - 42;
    this.TOP = 50;
    this.BOTTOM = this.pdf.height - 60;
    this.footer = `${stationName} · ${title}`;
    this.now = now;
    this.onBreak = null; // redraws a table's column heads on a new page

    const { pdf, L, R } = this;
    let y = this.TOP;
    pdf.rect(L, y, 13, 13, GASOIL).rect(L + 16, y, 13, 13, ESSENCE);
    pdf.text(L + 38, y + 11, stationName.toUpperCase(), { size: 11, bold: true });
    if (status) pdf.text(R, y + 11, status, { size: 9.5, bold: true, color: GREY, align: 'right' });
    y += 50;
    pdf.text(L, y, heading, { size: 24, bold: true });
    if (subtitle) {
      y += 20;
      pdf.text(L, y, subtitle, { size: 10, color: GREY });
    }
    this.y = y + 8;
  }

  room(h) {
    if (this.y + h <= this.BOTTOM) return;
    this.pdf.addPage();
    this.y = this.TOP;
    if (this.onBreak) this.onBreak();
  }

  // A title never sits alone at the foot of a page.
  section(title, note) {
    const { pdf, L, R } = this;
    this.onBreak = null;
    this.room(120);
    this.y += 30;
    pdf.text(L, this.y, title, { size: 13, bold: true });
    this.y += 8;
    pdf.line(L, this.y, R, this.y, { color: INK, width: 1 });
    if (note) {
      this.y += 14;
      pdf.text(L, this.y, fit(note, R - L, 8.5), { size: 8.5, color: GREY });
      this.y += 2;
    }
  }

  // Key/value line, the value right-aligned.
  line(label, value, { bold = false, color = INK } = {}) {
    const { pdf, L, R } = this;
    this.room(20);
    this.y += 15;
    pdf.text(L, this.y, label, { size: 10, bold });
    pdf.text(R, this.y, value, { size: 10, bold, color, align: 'right' });
    this.y += 6;
    pdf.line(L, this.y, R, this.y, { color: RULE });
  }

  // A short line of text, e.g. a warning under a section.
  note(text, { bold = false, color = GREY, size = 9 } = {}) {
    this.room(18);
    this.y += 16;
    this.pdf.text(this.L, this.y, fit(text, this.R - this.L, size, bold), { size, bold, color });
  }

  paragraph(label, text) {
    const { pdf, L, R } = this;
    this.room(36);
    this.y += 15;
    pdf.text(L, this.y, label, { size: 9.5, bold: true });
    for (const l of wrap(text || '', R - L, 9.5)) {
      this.room(16);
      this.y += 13;
      pdf.text(L, this.y, l, { size: 9.5 });
    }
  }

  // columns: [{ label, width, align: 'left' | 'right', indent }]; the last column takes the rest.
  table(columns, rows, { totals = [], empty, size = 9 } = {}) {
    const { pdf, L, R } = this;
    const widths = columns.map((c) => c.width || 0);
    widths[widths.length - 1] = R - L - widths.slice(0, -1).reduce((a, b) => a + b, 0);
    const cells = (values, style) => {
      let x = L;
      values.forEach((v, i) => {
        const c = columns[i];
        const w = widths[i];
        if (v !== '' && v != null) {
          if (c.align === 'right') pdf.text(x + w, this.y, fit(v, w - 6, style.size, style.bold), { ...style, align: 'right' });
          else pdf.text(x + (c.indent || 0), this.y, fit(v, w - 8 - (c.indent || 0), style.size, style.bold), style);
        }
        x += w;
      });
    };
    const heads = () => {
      this.y += 15;
      cells(columns.map((c) => c.label), { size: 7.5, bold: true, color: GREY });
      this.y += 6;
      pdf.line(L, this.y, R, this.y, { color: RULE });
    };
    if (!rows.length) {
      this.room(22);
      this.y += 16;
      pdf.text(L, this.y, empty || 'Rien sur cette période.', { size: 9.5, color: GREY });
      return;
    }
    this.room(40);
    heads();
    this.onBreak = heads;
    for (const row of rows) {
      this.room(20);
      this.y += size + 5;
      cells(row, { size });
      this.y += 6;
      pdf.line(L, this.y, R, this.y, { color: RULE });
    }
    this.onBreak = null;
    totals.forEach((row, i) => {
      this.room(20);
      if (i === 0) pdf.line(L, this.y, R, this.y, { color: INK, width: 0.8 });
      this.y += size + 6;
      cells(row, { size: size + 0.5, bold: true });
      this.y += 6;
    });
  }

  // Footers on every page, then the file.
  finish() {
    const { pdf, L, R } = this;
    const count = pdf.pages.length;
    for (let i = 0; i < count; i++) {
      pdf.usePage(i);
      const fy = pdf.height - 34;
      pdf.line(L, fy - 12, R, fy - 12, { color: RULE });
      pdf.text(L, fy, this.footer, { size: 8, color: GREY });
      pdf.text(R, fy, `Édité le ${fmt.dateTime(this.now)} · page ${i + 1}/${count}`, { size: 8, color: GREY, align: 'right' });
    }
    return pdf.toBuffer();
  }
}

module.exports = { Report, fmt, COLORS: { INK, GREY, RULE, GASOIL, ESSENCE, GOOD, BAD } };
