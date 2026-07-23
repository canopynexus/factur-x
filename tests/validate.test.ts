import { describe, expect, it } from 'vitest';
import { validateInvoice } from '../src/validate.js';
import type { Invoice } from '../src/types.js';

const valid: Invoice = {
  number: 'FA-2026-0100',
  issueDate: '2026-07-01',
  currency: 'EUR',
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
    name: 'Acme France SAS',
    address: { line1: '1 rue de la Paix', postCode: '75002', city: 'Paris', countryCode: 'FR' },
  },
  lines: [
    { name: 'Reblochon', quantity: 10, unitPrice: 6.9, vat: { categoryCode: 'S', rate: 5.5 } },
  ],
};

describe('validateInvoice', () => {
  it('accepts a well-formed invoice at every level with lines', () => {
    for (const level of ['basicwl', 'basic', 'en16931', 'extended'] as const) {
      expect(validateInvoice(valid, level).errors).toEqual([]);
    }
  });

  it('requires core identification fields', () => {
    const { errors } = validateInvoice({ ...valid, number: '', issueDate: 'July 1st' }, 'basic');
    expect(errors).toContain('number is required (BT-1)');
    expect(errors.some((e) => e.includes('YYYY-MM-DD'))).toBe(true);
  });

  it('rejects a bad currency code', () => {
    const { errors } = validateInvoice({ ...valid, currency: 'EURO' }, 'basic');
    expect(errors.some((e) => e.includes('ISO 4217'))).toBe(true);
  });

  it('requires totals at minimum level when there are no lines', () => {
    const { lines: _lines, ...noLines } = valid;
    expect(validateInvoice(noLines, 'minimum').errors).toContain(
      'totals are required at level "minimum" when no lines are provided',
    );
    const withTotals: Invoice = {
      ...noLines,
      totals: { taxBasis: 100, tax: 20, grand: 120, due: 120 },
    };
    expect(validateInvoice(withTotals, 'minimum').errors).toEqual([]);
  });

  it('requires lines above minimum level', () => {
    const { lines: _lines, ...noLines } = valid;
    const { errors } = validateInvoice(
      { ...noLines, totals: { taxBasis: 100, tax: 20, grand: 120, due: 120 } },
      'basicwl',
    );
    expect(errors.some((e) => e.startsWith('lines are required'))).toBe(true);
  });

  it('rejects inconsistent declared totals (BR-CO-15/16)', () => {
    const { errors } = validateInvoice(
      {
        ...valid,
        lines: undefined,
        totals: { taxBasis: 100, tax: 20, grand: 130, due: 130 },
      },
      'minimum',
    );
    expect(errors.some((e) => e.includes('BR-CO-15'))).toBe(true);
  });

  it('cross-checks declared totals against lines', () => {
    const { errors } = validateInvoice(
      { ...valid, totals: { taxBasis: 999, tax: 3.8, grand: 72.8, due: 72.8 } },
      'basic',
    );
    expect(errors.some((e) => e.includes('totals.taxBasis'))).toBe(true);
  });

  it('requires a VAT rate on standard-rated lines', () => {
    const { errors } = validateInvoice(
      { ...valid, lines: [{ name: 'X', quantity: 1, unitPrice: 10, vat: { categoryCode: 'S' } }] },
      'basic',
    );
    expect(errors.some((e) => e.includes('vat.rate is required'))).toBe(true);
  });

  it('requires exemption reasons for exempt categories at en16931', () => {
    const exempt: Invoice = {
      ...valid,
      lines: [{ name: 'Export', quantity: 1, unitPrice: 100, vat: { categoryCode: 'G' } }],
    };
    expect(validateInvoice(exempt, 'en16931').errors.some((e) => e.includes('BT-120'))).toBe(true);
    // Only a warning at basic level.
    const basic = validateInvoice(exempt, 'basic');
    expect(basic.errors).toEqual([]);
    expect(basic.warnings.some((w) => w.includes('BT-120'))).toBe(true);
    // Satisfied by a reason.
    const withReason: Invoice = {
      ...exempt,
      vatExemptions: { G: { reason: 'Export outside EU' } },
    };
    expect(validateInvoice(withReason, 'en16931').errors).toEqual([]);
  });

  it('rejects negative unit prices (BR-27)', () => {
    const { errors } = validateInvoice(
      {
        ...valid,
        lines: [
          { name: 'Rebate', quantity: 1, unitPrice: -5, vat: { categoryCode: 'S', rate: 20 } },
        ],
      },
      'basic',
    );
    expect(errors.some((e) => e.includes('BR-27'))).toBe(true);
  });
});
