import { describe, expect, it } from 'vitest';
import { computeTotals } from '../src/totals.js';
import type { Invoice } from '../src/types.js';

const base: Invoice = {
  number: 'T-1',
  issueDate: '2026-01-15',
  currency: 'EUR',
  seller: { name: 'Reblochon SARL', address: { countryCode: 'FR' }, vatId: 'FR32532198476' },
  buyer: { name: 'Acme France SAS', address: { countryCode: 'FR' } },
};

describe('computeTotals', () => {
  it('groups VAT by category and rate', () => {
    const totals = computeTotals({
      ...base,
      lines: [
        { name: 'Reblochon', quantity: 40, unitPrice: 6.9, vat: { categoryCode: 'S', rate: 5.5 } },
        { name: 'Tomme', quantity: 12, unitPrice: 11.2, vat: { categoryCode: 'S', rate: 5.5 } },
        { name: 'Livraison', quantity: 1, unitPrice: 48, vat: { categoryCode: 'S', rate: 20 } },
      ],
    });
    expect(totals.lineTotal).toBe(458.4);
    expect(totals.vatBreakdown).toHaveLength(2);
    const [reduced, standard] = totals.vatBreakdown;
    expect(reduced).toMatchObject({ rate: 5.5, basis: 410.4, tax: 22.57 });
    expect(standard).toMatchObject({ rate: 20, basis: 48, tax: 9.6 });
    expect(totals.tax).toBe(32.17);
    expect(totals.grand).toBe(490.57);
    expect(totals.due).toBe(490.57);
  });

  it('computes zero VAT for exempt categories', () => {
    const totals = computeTotals({
      ...base,
      vatExemptions: { K: { reason: 'Intra-community supply', code: 'VATEX-EU-IC' } },
      lines: [{ name: 'Export', quantity: 200, unitPrice: 6.1, vat: { categoryCode: 'K' } }],
    });
    expect(totals.tax).toBe(0);
    expect(totals.grand).toBe(1220);
    expect(totals.vatBreakdown[0]).toMatchObject({
      categoryCode: 'K',
      tax: 0,
      exemptionReason: 'Intra-community supply',
      exemptionReasonCode: 'VATEX-EU-IC',
    });
  });

  it('deducts prepaid amounts from the amount due', () => {
    const totals = computeTotals({
      ...base,
      totals: { taxBasis: 0, tax: 0, grand: 0, due: 0, prepaid: 500 },
      lines: [
        { name: 'Abondance', quantity: 4, unitPrice: 185, vat: { categoryCode: 'S', rate: 5.5 } },
        { name: 'Cave', quantity: 3, unitPrice: 220, vat: { categoryCode: 'S', rate: 20 } },
      ],
    });
    expect(totals.grand).toBe(1572.7);
    expect(totals.due).toBe(1072.7);
  });
});
