import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatAmount } from '../money.js';
import { lineNetAmount, resolveTotals } from '../totals.js';
import type { CreateOptions, Invoice, Party } from '../types.js';

const PAGE = { width: 595.28, height: 841.89 }; // A4 portrait
const MARGIN = 50;
const INK = rgb(0.13, 0.13, 0.15);
const MUTED = rgb(0.45, 0.45, 0.5);
const RULE = rgb(0.85, 0.85, 0.88);

/**
 * The standard 14 fonts use WinAnsi encoding: Latin-1 plus €, curly quotes and
 * dashes. Intl formatting emits narrow no-break spaces (fr-FR group
 * separators) that WinAnsi cannot encode, so normalise those and replace
 * anything else unsupported.
 */
function sanitize(value: string): string {
  return value
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F]/g, ' ')
    .replace(/[\u2010-\u2012\u2212]/g, '-')
    .replace(/[^\u0020-\u007E\u00A1-\u00FF\u20AC\u2013\u2014\u2018\u2019\u201C\u201D]/g, '?');
}

interface Cursor {
  page: PDFPage;
  y: number;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function renderPdf(invoice: Invoice, options: CreateOptions): Promise<PDFDocument> {
  const locale = options.locale ?? 'en-GB';
  const money = (value: number) => sanitize(formatAmount(value, invoice.currency, locale));
  const totals = resolveTotals(invoice);
  if (!totals) throw new Error('cannot render a PDF without lines or totals');

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const cursor: Cursor = { page: doc.addPage([PAGE.width, PAGE.height]), y: PAGE.height - MARGIN };

  const draw = (
    text: string,
    x: number,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; right?: number } = {},
  ) => {
    const f = opts.font ?? font;
    const size = opts.size ?? 9;
    const content = sanitize(text);
    const xPos = opts.right !== undefined ? opts.right - f.widthOfTextAtSize(content, size) : x;
    cursor.page.drawText(content, {
      x: xPos,
      y: cursor.y,
      size,
      font: f,
      color: opts.color ?? INK,
    });
  };

  const rule = () => {
    cursor.page.drawLine({
      start: { x: MARGIN, y: cursor.y },
      end: { x: PAGE.width - MARGIN, y: cursor.y },
      thickness: 0.7,
      color: RULE,
    });
  };

  const newLine = (height = 13) => {
    cursor.y -= height;
    if (cursor.y < MARGIN + 40) {
      cursor.page = doc.addPage([PAGE.width, PAGE.height]);
      cursor.y = PAGE.height - MARGIN;
    }
  };

  // ---- Header: seller identity left, invoice identification right ----------
  draw(invoice.seller.name, MARGIN, { font: bold, size: 16 });
  draw('INVOICE', 0, { font: bold, size: 16, right: PAGE.width - MARGIN });
  newLine(18);
  const sellerLines = partyAddressLines(invoice.seller);
  const headerRight: [string, string][] = [
    ['Invoice no.', invoice.number],
    ['Issue date', invoice.issueDate],
  ];
  if (invoice.payment?.dueDate) headerRight.push(['Due date', invoice.payment.dueDate]);
  if (invoice.buyerReference) headerRight.push(['Buyer reference', invoice.buyerReference]);
  if (invoice.purchaseOrderReference)
    headerRight.push(['Order ref.', invoice.purchaseOrderReference]);
  const headerRows = Math.max(sellerLines.length, headerRight.length);
  for (let i = 0; i < headerRows; i++) {
    const left = sellerLines[i];
    if (left) draw(left, MARGIN, { color: MUTED });
    const right = headerRight[i];
    if (right) {
      draw(right[0], PAGE.width - MARGIN - 170, { color: MUTED });
      draw(right[1], 0, { font: bold, right: PAGE.width - MARGIN });
    }
    newLine(12);
  }
  newLine(10);

  // ---- Buyer block ---------------------------------------------------------
  draw('BILLED TO', MARGIN, { font: bold, size: 8, color: MUTED });
  newLine(12);
  draw(invoice.buyer.name, MARGIN, { font: bold, size: 10 });
  newLine(12);
  for (const line of partyAddressLines(invoice.buyer)) {
    draw(line, MARGIN, { color: MUTED });
    newLine(11);
  }
  newLine(14);

  // ---- Line table ----------------------------------------------------------
  const col = {
    qty: MARGIN + 280,
    unitPrice: MARGIN + 360,
    vat: MARGIN + 400,
    amount: PAGE.width - MARGIN,
  };
  if (invoice.lines && invoice.lines.length > 0) {
    draw('Description', MARGIN, { font: bold, size: 8, color: MUTED });
    draw('Qty', 0, { font: bold, size: 8, color: MUTED, right: col.qty });
    draw('Unit price', 0, { font: bold, size: 8, color: MUTED, right: col.unitPrice });
    draw('VAT', 0, { font: bold, size: 8, color: MUTED, right: col.vat });
    draw('Amount', 0, { font: bold, size: 8, color: MUTED, right: col.amount });
    newLine(6);
    rule();
    newLine(14);
    for (const line of invoice.lines) {
      draw(line.name, MARGIN);
      draw(String(line.quantity), 0, { right: col.qty });
      draw(money(line.unitPrice), 0, { right: col.unitPrice });
      draw(line.vat.rate !== undefined ? `${line.vat.rate}%` : line.vat.categoryCode, 0, {
        right: col.vat,
      });
      draw(money(lineNetAmount(line)), 0, { right: col.amount });
      if (line.description) {
        newLine(11);
        draw(line.description, MARGIN, { size: 8, color: MUTED });
      }
      newLine(14);
    }
    rule();
    newLine(16);
  }

  // ---- VAT breakdown + totals ---------------------------------------------
  for (const group of totals.vatBreakdown) {
    draw(`VAT ${group.categoryCode} ${group.rate}% on ${money(group.basis)}`, MARGIN, {
      size: 8,
      color: MUTED,
    });
    draw(money(group.tax), 0, { size: 8, color: MUTED, right: col.amount });
    newLine(11);
    if (group.exemptionReason) {
      const maxWidth = col.amount - MARGIN;
      for (const line of wrapText(group.exemptionReason, font, 8, maxWidth)) {
        draw(line, MARGIN, { size: 8, color: MUTED });
        newLine(11);
      }
    }
  }
  newLine(4);
  const totalRows: [string, string, boolean][] = [
    ['Total excl. VAT', money(totals.taxBasis), false],
    ['Total VAT', money(totals.tax), false],
    ['Total incl. VAT', money(totals.grand), false],
  ];
  if (totals.prepaid !== 0) totalRows.push(['Prepaid', money(totals.prepaid), false]);
  totalRows.push(['Amount due', money(totals.due), true]);
  for (const [label, value, strong] of totalRows) {
    draw(label, col.unitPrice - 60, { font: strong ? bold : font, size: strong ? 11 : 9 });
    draw(value, 0, { font: strong ? bold : font, size: strong ? 11 : 9, right: col.amount });
    newLine(strong ? 16 : 13);
  }
  newLine(10);

  // ---- Payment & notes footer ---------------------------------------------
  const payment = invoice.payment;
  if (payment?.terms || payment?.iban) {
    draw('PAYMENT', MARGIN, { font: bold, size: 8, color: MUTED });
    newLine(12);
    if (payment.terms) {
      draw(payment.terms, MARGIN);
      newLine(12);
    }
    if (payment.iban) {
      draw(`IBAN ${payment.iban}${payment.bic ? `  ·  BIC ${payment.bic}` : ''}`, MARGIN);
      newLine(12);
    }
    if (payment.reference) {
      draw(`Payment reference: ${payment.reference}`, MARGIN);
      newLine(12);
    }
    newLine(6);
  }
  for (const note of invoice.notes ?? []) {
    draw(note, MARGIN, { size: 8, color: MUTED });
    newLine(11);
  }

  return doc;
}

function partyAddressLines(party: Party): string[] {
  const lines: string[] = [];
  const a = party.address;
  if (a?.line1) lines.push(a.line1);
  if (a?.line2) lines.push(a.line2);
  const cityLine = [a?.postCode, a?.city].filter(Boolean).join(' ');
  if (cityLine) lines.push(cityLine);
  if (a?.countryCode) lines.push(a.countryCode);
  if (party.vatId) lines.push(`VAT: ${party.vatId}`);
  if (party.legalId?.value) lines.push(`Reg: ${party.legalId.value}`);
  if (party.email) lines.push(party.email);
  return lines;
}
