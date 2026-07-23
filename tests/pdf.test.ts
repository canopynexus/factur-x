import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { create, extract, verify } from '../src/index.js';
import type { Invoice } from '../src/types.js';

const invoice: Invoice = {
  number: 'FA-2026-0300',
  issueDate: '2026-07-01',
  currency: 'GBP',
  seller: {
    name: 'Reblochon SARL',
    vatId: 'FR32532198476',
    address: {
      line1: '12 route des Alpages',
      postCode: '74230',
      city: 'Thônes',
      countryCode: 'FR',
    },
  },
  buyer: {
    name: 'Acme Trading Ltd',
    legalId: { value: '09876543', scheme: '0060' },
    address: {
      line1: '221B Cheddar Lane',
      postCode: 'SW1A 1AA',
      city: 'London',
      countryCode: 'GB',
    },
  },
  lines: [
    { name: 'Reblochon fermier AOP', quantity: 150, unitPrice: 5.8, vat: { categoryCode: 'G' } },
  ],
  vatExemptions: { G: { reason: 'Export outside the EU', code: 'VATEX-EU-G' } },
  payment: { iban: 'FR7630006000011234567890189', dueDate: '2026-08-01' },
};

describe('create → extract → verify round trip', () => {
  it('embeds the XML in the PDF and gets it back byte-identical', async () => {
    const created = await create(invoice, {
      level: 'en16931',
      now: new Date('2026-07-01T12:00:00Z'),
    });
    expect(created.pdf).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder('latin1').decode(created.pdf!.subarray(0, 5))).toBe('%PDF-');

    const extracted = await extract(created.pdf!);
    expect(extracted.filename).toBe('factur-x.xml');
    expect(extracted.xml).toBe(created.xml);
  });

  it('verifies the hybrid PDF and reports the level', async () => {
    const { pdf } = await create(invoice, { level: 'basic' });
    const result = await verify(pdf!);
    expect(result).toMatchObject({ valid: true, level: 'basic', source: 'pdf' });
  });

  it('verifies plain XML and reports the level', async () => {
    const { xml } = await create(invoice, { level: 'extended', format: 'xml' });
    const result = await verify(xml);
    expect(result).toMatchObject({ valid: true, level: 'extended', source: 'xml' });
  });

  it('declares Factur-X metadata (XMP + AF) in the PDF', async () => {
    const { pdf } = await create(invoice, { level: 'en16931' });
    const raw = new TextDecoder('latin1').decode(pdf!);
    expect(raw).toContain('fx:ConformanceLevel>EN 16931<');
    expect(raw).toContain('factur-x.xml');
    expect(raw).toContain('pdfaid:part>3<');
    const doc = await PDFDocument.load(pdf!, { updateMetadata: false });
    const af = doc.catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
    expect(af?.size()).toBe(1);
  });

  it('rejects a PDF without an embedded invoice', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = await doc.save();
    await expect(extract(bytes)).rejects.toThrow('no embedded files');
    const result = await verify(bytes);
    expect(result.valid).toBe(false);
  });

  it('rejects input that is neither PDF nor XML', async () => {
    const result = await verify('hello, cheese');
    expect(result).toMatchObject({ valid: false, source: 'unknown' });
  });

  it('refuses to create an invoice that fails level validation', async () => {
    const bad = { ...invoice, lines: undefined };
    await expect(create(bad, { level: 'en16931' })).rejects.toThrow('lines are required');
  });
});
