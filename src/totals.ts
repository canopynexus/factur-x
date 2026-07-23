import { roundMoney } from './money.js';
import type { Invoice, InvoiceLine, InvoiceTotals, VatCategoryCode } from './types.js';

export interface VatBreakdownEntry {
  categoryCode: VatCategoryCode;
  rate: number;
  basis: number;
  tax: number;
  exemptionReason?: string;
  exemptionReasonCode?: string;
}

export interface ComputedTotals extends Required<Omit<InvoiceTotals, 'prepaid'>> {
  prepaid: number;
  vatBreakdown: VatBreakdownEntry[];
}

export function lineNetAmount(line: InvoiceLine): number {
  return roundMoney(line.quantity * line.unitPrice);
}

/**
 * Compute document totals and the VAT breakdown (BG-23) from invoice lines.
 * VAT is calculated per category/rate group on the rounded group basis, which
 * is the calculation EN 16931 rule BR-CO-17 expects.
 */
export function computeTotals(invoice: Invoice): ComputedTotals {
  const lines = invoice.lines ?? [];
  const groups = new Map<string, VatBreakdownEntry>();
  let lineTotal = 0;

  for (const line of lines) {
    const net = lineNetAmount(line);
    lineTotal = roundMoney(lineTotal + net);
    const rate = line.vat.rate ?? 0;
    const key = `${line.vat.categoryCode}:${rate}`;
    const group = groups.get(key) ?? {
      categoryCode: line.vat.categoryCode,
      rate,
      basis: 0,
      tax: 0,
    };
    group.basis = roundMoney(group.basis + net);
    groups.set(key, group);
  }

  let tax = 0;
  for (const group of groups.values()) {
    group.tax = group.categoryCode === 'S' ? roundMoney((group.basis * group.rate) / 100) : 0;
    tax = roundMoney(tax + group.tax);
    const exemption = invoice.vatExemptions?.[group.categoryCode];
    if (exemption) {
      group.exemptionReason = exemption.reason;
      group.exemptionReasonCode = exemption.code;
    }
  }

  const taxBasis = lineTotal;
  const grand = roundMoney(taxBasis + tax);
  const prepaid = invoice.totals?.prepaid ?? 0;
  const due = roundMoney(grand - prepaid);

  return {
    lineTotal,
    taxBasis,
    tax,
    grand,
    prepaid,
    due,
    vatBreakdown: [...groups.values()].sort(
      (a, b) => a.categoryCode.localeCompare(b.categoryCode) || a.rate - b.rate,
    ),
  };
}

/**
 * Resolve the totals to put on the invoice: computed from lines when lines are
 * present, otherwise taken from `invoice.totals`. Returns `undefined` when
 * neither source is available.
 */
export function resolveTotals(invoice: Invoice): ComputedTotals | undefined {
  if (invoice.lines && invoice.lines.length > 0) return computeTotals(invoice);
  const t = invoice.totals;
  if (!t) return undefined;
  return {
    lineTotal: t.lineTotal ?? t.taxBasis,
    taxBasis: t.taxBasis,
    tax: t.tax,
    grand: t.grand,
    prepaid: t.prepaid ?? 0,
    due: t.due,
    vatBreakdown: [],
  };
}

/** Cross-check user-supplied totals against totals computed from the lines. */
export function totalsMismatches(computed: ComputedTotals, declared: InvoiceTotals): string[] {
  const problems: string[] = [];
  const check = (label: string, expected: number, actual: number | undefined) => {
    if (actual !== undefined && Math.abs(expected - actual) > 0.005) {
      problems.push(`totals.${label} is ${actual} but the lines add up to ${expected}`);
    }
  };
  check('lineTotal', computed.lineTotal, declared.lineTotal);
  check('taxBasis', computed.taxBasis, declared.taxBasis);
  check('tax', computed.tax, declared.tax);
  check('grand', computed.grand, declared.grand);
  check('due', computed.due, declared.due);
  return problems;
}
