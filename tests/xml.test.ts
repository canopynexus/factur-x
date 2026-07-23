import { describe, expect, it } from 'vitest';
import { LEVEL_URNS, ALL_LEVELS } from '../src/levels.js';
import { buildXml } from '../src/xml/build.js';
import { checkXml } from '../src/xml/parse.js';
import type { Invoice } from '../src/types.js';

const invoice: Invoice = {
  number: 'FA-2026-0200',
  issueDate: '2026-07-01',
  currency: 'EUR',
  buyerReference: 'ACME-77',
  seller: {
    name: 'Reblochon SARL',
    legalId: { value: '532198476', scheme: '0002' },
    vatId: 'FR32532198476',
    address: {
      line1: '12 route des Alpages',
      postCode: '74230',
      city: 'Thônes',
      countryCode: 'FR',
    },
  },
  buyer: {
    name: 'Acme France SAS',
    vatId: 'FR90410108494',
    address: { line1: '1 rue de la Paix', postCode: '75002', city: 'Paris', countryCode: 'FR' },
  },
  lines: [
    {
      name: 'Reblochon fermier AOP',
      quantity: 40,
      unitPrice: 6.9,
      unit: 'H87',
      vat: { categoryCode: 'S', rate: 5.5 },
    },
    { name: 'Livraison', quantity: 1, unitPrice: 48, vat: { categoryCode: 'S', rate: 20 } },
  ],
  payment: { iban: 'FR7630006000011234567890189', dueDate: '2026-08-01', terms: '30 jours' },
};

describe('buildXml', () => {
  it('emits the correct guideline URN for each level', () => {
    for (const level of ALL_LEVELS) {
      const xml = buildXml(invoice, level);
      expect(xml).toContain(`<ram:ID>${LEVEL_URNS[level]}</ram:ID>`);
    }
  });

  it('formats dates with CII format 102', () => {
    const xml = buildXml(invoice, 'en16931');
    expect(xml).toContain('<udt:DateTimeString format="102">20260701</udt:DateTimeString>');
  });

  it('omits lines below basic level but keeps the VAT breakdown at basicwl', () => {
    const basicwl = buildXml(invoice, 'basicwl');
    expect(basicwl).not.toContain('IncludedSupplyChainTradeLineItem');
    expect(basicwl).toContain('ram:ApplicableTradeTax');
    const minimum = buildXml(invoice, 'minimum');
    expect(minimum).not.toContain('IncludedSupplyChainTradeLineItem');
    expect(minimum).not.toContain('ram:ApplicableTradeTax');
    expect(minimum).toContain('<ram:TaxBasisTotalAmount>324.00</ram:TaxBasisTotalAmount>');
  });

  it('includes line items and totals at basic level and above', () => {
    const xml = buildXml(invoice, 'basic');
    expect(xml).toContain('<ram:LineTotalAmount>276.00</ram:LineTotalAmount>');
    expect(xml).toContain('<ram:BilledQuantity unitCode="H87">40</ram:BilledQuantity>');
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">24.78</ram:TaxTotalAmount>');
    expect(xml).toContain('<ram:GrandTotalAmount>348.78</ram:GrandTotalAmount>');
  });

  it('escapes XML special characters', () => {
    const xml = buildXml(
      { ...invoice, buyer: { ...invoice.buyer, name: 'Acme & Fils <SARL>' } },
      'en16931',
    );
    expect(xml).toContain('Acme &amp; Fils &lt;SARL&gt;');
  });
});

describe('checkXml', () => {
  it('round-trips every level produced by buildXml', () => {
    for (const level of ALL_LEVELS) {
      const result = checkXml(buildXml(invoice, level));
      expect(result.errors).toEqual([]);
      expect(result.level).toBe(level);
    }
  });

  it('rejects non-CII XML', () => {
    const result = checkXml('<invoice><total>10</total></invoice>');
    expect(result.errors[0]).toContain('rsm:CrossIndustryInvoice');
  });

  it('rejects malformed XML', () => {
    expect(checkXml('<rsm:CrossIndustryInvoice>').errors[0]).toContain('not well-formed');
  });

  it('rejects unknown guidelines', () => {
    const xml = buildXml(invoice, 'en16931').replace(LEVEL_URNS.en16931, 'urn:example:not-facturx');
    expect(checkXml(xml).errors[0]).toContain('not a known Factur-X');
  });

  it('detects tampered totals (BR-CO-15)', () => {
    const xml = buildXml(invoice, 'en16931').replace(
      '<ram:GrandTotalAmount>348.78</ram:GrandTotalAmount>',
      '<ram:GrandTotalAmount>999.99</ram:GrandTotalAmount>',
    );
    const result = checkXml(xml);
    expect(result.errors.some((e) => e.includes('BR-CO-15'))).toBe(true);
  });

  it('detects a VAT breakdown that does not add up (BR-CO-14)', () => {
    const xml = buildXml(invoice, 'en16931').replace(
      '<ram:CalculatedAmount>9.60</ram:CalculatedAmount>',
      '<ram:CalculatedAmount>5.00</ram:CalculatedAmount>',
    );
    expect(checkXml(xml).errors.some((e) => e.includes('BR-CO-14'))).toBe(true);
  });
});
