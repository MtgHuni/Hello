// Layout shared by the PDF reports (shift, period, customer statement): A4 page,
// brand header, ruled sections, key/value lines, tables that continue across pages
// with their column heads, and page footers once the page count is known.
const { Pdf, fit, wrap, textWidth } = require('./pdf');

const TZ = 'Africa/Lubumbashi';
const INK = [10, 10, 11];
// Dark enough to print clearly on an office printer.
const GREY = [82, 82, 78];
// Type sizes (points), readable on paper: table text, column heads, the smallest a wide table goes.
const BODY = 9.5;
const HEAD = 8;
const SMALLEST = 8.5;
const GAP = 10; // space between columns
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
    for (const [n, l] of (subtitle ? wrap(subtitle, R - L, 10) : []).entries()) {
      y += n ? 13 : 20;
      pdf.text(L, y, l, { size: 10, color: GREY });
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
    for (const [n, l] of (note ? wrap(note, R - L, 9) : []).entries()) {
      this.y += n ? 12 : 15;
      pdf.text(L, this.y, l, { size: 9, color: GREY });
    }
    if (note) this.y += 2;
  }

  // Key/value line, the value right-aligned; a long label goes on to a second line.
  line(label, value, { bold = false, color = INK } = {}) {
    const { pdf, L, R } = this;
    const lines = wrap(label, R - L - textWidth(value, 10.5, bold) - 24, 10.5, bold);
    this.room(8 + lines.length * 14);
    this.y += 15;
    pdf.text(R, this.y, value, { size: 10.5, bold, color, align: 'right' });
    lines.forEach((l, n) => pdf.text(L, this.y + n * 13.5, l, { size: 10.5, bold }));
    this.y += (lines.length - 1) * 13.5 + 6;
    pdf.line(L, this.y, R, this.y, { color: RULE });
  }

  // A short text, e.g. a warning under a section, on as many lines as it takes.
  note(text, { bold = false, color = GREY, size = 9.5 } = {}) {
    const lines = wrap(text, this.R - this.L, size, bold);
    this.room(6 + lines.length * (size + 4));
    lines.forEach((l, n) => {
      this.y += n ? size + 3.5 : 16;
      this.pdf.text(this.L, this.y, l, { size, bold, color });
    });
  }

  paragraph(label, text) {
    const { pdf, L, R } = this;
    this.room(36);
    this.y += 15;
    pdf.text(L, this.y, label, { size: 10, bold: true });
    for (const l of wrap(text || '', R - L, 10)) {
      this.room(16);
      this.y += 13.5;
      pdf.text(L, this.y, l, { size: 10 });
    }
  }

  // Column widths that show every word on A4: figures (right-aligned) never wrap and take the width
  // they need; text columns share the rest, in proportion to their `width` hint, and wrap onto
  // several lines. Null when even the narrowest layout does not fit at this size.
  layout(columns, rows, totals, size) {
    const avail = this.R - this.L;
    const measures = columns.map((c, i) => {
      const values = [...rows.map((r) => [r[i], false]), ...totals.map((r) => [r[i], true])].filter(([v]) => v !== '' && v != null);
      const width = ([v, bold]) => textWidth(String(v), bold ? size + 0.5 : size, bold);
      const longest = (list) => Math.max(0, ...list);
      const content = longest(values.map(width));
      const word = longest(values.flatMap(([v, bold]) => String(v).split(/\s+/).map((w) => width([w, bold]))));
      const head = textWidth(c.label, HEAD, true);
      const headWord = longest(c.label.split(/\s+/).map((w) => textWidth(w, HEAD, true)));
      const pad = GAP + (c.indent || 0);
      return c.align === 'right'
        ? { min: Math.max(content, headWord) + pad, max: Math.max(content, head) + pad }
        : { min: Math.max(word, headWord) + pad, max: Math.max(content, head) + pad };
    });
    const sumMin = measures.reduce((t, m) => t + m.min, 0);
    const sumMax = measures.reduce((t, m) => t + m.max, 0);
    if (sumMax <= avail) {
      // Room to spare: shared in proportion to the hints, the table spans the page.
      const hints = columns.map((c, i) => c.width || measures[i].max);
      const total = hints.reduce((a, b) => a + b, 0);
      return measures.map((m, i) => m.max + ((avail - sumMax) * hints[i]) / total);
    }
    if (sumMin > avail) return null;
    // Short columns (a date, a name) keep one line; the long ones (a label, a description) wrap.
    const short = measures.map((m, i) => columns[i].align !== 'right' && m.max <= avail * 0.2);
    const kept = measures.reduce((t, m, i) => t + (short[i] ? m.max : m.min), 0);
    const spread = measures.reduce((t, m, i) => t + (short[i] ? 0 : m.max - m.min), 0);
    if (kept <= avail && spread > 0) return measures.map((m, i) => (short[i] ? m.max : m.min + ((m.max - m.min) * Math.min(1, (avail - kept) / spread))));
    const k = (avail - sumMin) / (sumMax - sumMin);
    return measures.map((m) => m.min + (m.max - m.min) * k);
  }

  // columns: [{ label, width (a hint), align: 'left' | 'right', indent }]. Nothing is cut: a cell too
  // long for its column goes on to the next line, and a table too wide is written a little smaller.
  table(columns, rows, { totals = [], empty } = {}) {
    const { pdf, L, R } = this;
    if (!rows.length) {
      this.room(22);
      this.y += 16;
      pdf.text(L, this.y, empty || 'Rien sur cette période.', { size: BODY, color: GREY });
      return;
    }
    let size = BODY;
    let widths = this.layout(columns, rows, totals, size);
    while (!widths && size > SMALLEST) widths = this.layout(columns, rows, totals, (size -= 0.5));
    if (!widths) widths = columns.map(() => (R - L) / columns.length);
    // Each cell as its lines: text wraps between words, a figure stays on one line.
    const linesOf = (values, style) =>
      values.map((v, i) => {
        if (v === '' || v == null) return [];
        const w = widths[i] - GAP - (columns[i].indent || 0);
        return columns[i].align === 'right' ? [fit(v, widths[i] - 2, style.size, style.bold)] : wrap(String(v), w, style.size, style.bold);
      });
    const draw = (values, style, leading) => {
      const cells = linesOf(values, style);
      const count = Math.max(1, ...cells.map((c) => c.length));
      this.room(count * leading + 10);
      const top = this.y;
      let x = L;
      cells.forEach((lines, i) => {
        const c = columns[i];
        lines.forEach((l, n) => {
          const y = top + style.size + 4 + n * leading;
          if (c.align === 'right') pdf.text(x + widths[i], y, l, { ...style, align: 'right' });
          else pdf.text(x + (c.indent || 0), y, l, style);
        });
        x += widths[i];
      });
      this.y = top + style.size + 4 + (count - 1) * leading + 6;
    };
    const heads = () => {
      this.y += 4;
      draw(columns.map((c) => c.label), { size: HEAD, bold: true, color: GREY }, HEAD + 2);
      pdf.line(L, this.y, R, this.y, { color: RULE });
    };
    this.room(48);
    heads();
    this.onBreak = heads;
    for (const row of rows) {
      draw(row, { size }, size + 3);
      pdf.line(L, this.y, R, this.y, { color: RULE });
    }
    this.onBreak = null;
    totals.forEach((row, i) => {
      if (i === 0) pdf.line(L, this.y, R, this.y, { color: INK, width: 0.8 });
      this.y += 1;
      draw(row, { size: size + 0.5, bold: true }, size + 3.5);
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
      const edited = `Édité le ${fmt.dateTime(this.now)} · page ${i + 1}/${count}`;
      pdf.text(R, fy, edited, { size: 8.5, color: GREY, align: 'right' });
      pdf.text(L, fy, fit(this.footer, R - L - textWidth(edited, 8.5) - 16, 8.5), { size: 8.5, color: GREY });
    }
    return pdf.toBuffer();
  }
}

module.exports = { Report, fmt, COLORS: { INK, GREY, RULE, GASOIL, ESSENCE, GOOD, BAD } };
