import { levelHasFullHeader, levelHasLines } from './levels.js';
import { computeTotals, totalsMismatches } from './totals.js';
import type { FacturXLevel, Invoice, VatCategoryCode } from './types.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const VAT_CATEGORIES: readonly VatCategoryCode[] = ['S', 'Z', 'E', 'AE', 'K', 'G', 'O', 'L', 'M'];
/** Categories whose VAT breakdown needs an exemption reason under EN 16931 (BR-E/AE/IC/G/O-10). */
const EXEMPTION_CATEGORIES: readonly VatCategoryCode[] = ['E', 'AE', 'K', 'G', 'O'];

export interface ValidationReport {
  errors: string[];
  warnings: string[];
}

/**
 * Validate an invoice object against a Factur-X level before generation.
 *
 * This enforces the structural requirements of each profile (mandatory terms,
 * line rules, totals consistency). It is not a full Schematron run of the
 * EN 16931 business rules — see the README compliance notes.
 */
export function validateInvoice(invoice: Invoice, level: FacturXLevel): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!invoice.number) errors.push('number is required (BT-1)');
  if (!invoice.issueDate) errors.push('issueDate is required (BT-2)');
  else if (!DATE_RE.test(invoice.issueDate)) {
    errors.push(`issueDate "${invoice.issueDate}" must be formatted YYYY-MM-DD`);
  }
  if (!invoice.currency) errors.push('currency is required (BT-5)');
  else if (!CURRENCY_RE.test(invoice.currency)) {
    errors.push(`currency "${invoice.currency}" must be a 3-letter ISO 4217 code`);
  }
  if (invoice.typeCode !== undefined && !/^\d{3}$/.test(invoice.typeCode)) {
    errors.push(`typeCode "${invoice.typeCode}" must be a 3-digit UNTDID 1001 code`);
  }

  if (!invoice.seller?.name) errors.push('seller.name is required (BT-27)');
  if (!invoice.seller?.address?.countryCode) {
    errors.push('seller.address.countryCode is required (BT-40)');
  }
  if (!invoice.seller?.vatId && !invoice.seller?.legalId?.value) {
    errors.push('seller needs a vatId (BT-31) or a legalId (BT-30) at every level');
  }
  if (!invoice.buyer?.name) errors.push('buyer.name is required (BT-44)');

  if (levelHasFullHeader(level)) {
    if (!invoice.buyer?.address?.countryCode) {
      errors.push(`buyer.address.countryCode is required (BT-55) at level "${level}"`);
    }
    if (!invoice.lines || invoice.lines.length === 0) {
      errors.push(
        `lines are required at level "${level}" — the "${level === 'basicwl' ? 'basicwl' : level}" profile ` +
          (levelHasLines(level)
            ? 'includes them in the XML'
            : 'omits them from the XML but needs them to compute the VAT breakdown (BG-23)'),
      );
    }
  } else if ((!invoice.lines || invoice.lines.length === 0) && !invoice.totals) {
    errors.push('totals are required at level "minimum" when no lines are provided');
  }

  invoice.lines?.forEach((line, index) => {
    const at = `lines[${index}]`;
    if (!line.name) errors.push(`${at}.name is required (BT-153)`);
    if (typeof line.quantity !== 'number' || Number.isNaN(line.quantity)) {
      errors.push(`${at}.quantity must be a number (BT-129)`);
    }
    if (typeof line.unitPrice !== 'number' || Number.isNaN(line.unitPrice)) {
      errors.push(`${at}.unitPrice must be a number (BT-146)`);
    } else if (line.unitPrice < 0) {
      errors.push(`${at}.unitPrice must not be negative (BR-27) — use a negative quantity instead`);
    }
    if (!line.vat?.categoryCode) {
      errors.push(`${at}.vat.categoryCode is required (BT-151)`);
    } else if (!VAT_CATEGORIES.includes(line.vat.categoryCode)) {
      errors.push(
        `${at}.vat.categoryCode "${line.vat.categoryCode}" is not a UNTDID 5305 category ` +
          `(expected one of ${VAT_CATEGORIES.join(', ')})`,
      );
    } else if (line.vat.categoryCode === 'S') {
      if (line.vat.rate === undefined) {
        errors.push(`${at}.vat.rate is required for standard-rated (S) lines (BT-152)`);
      }
    } else if (line.vat.rate !== undefined && line.vat.rate !== 0) {
      errors.push(
        `${at}.vat.rate must be 0 or omitted for category "${line.vat.categoryCode}" lines`,
      );
    }
  });

  if (invoice.lines && invoice.lines.length > 0) {
    const computed = computeTotals(invoice);
    if (invoice.totals) {
      errors.push(...totalsMismatches(computed, invoice.totals));
    }
    for (const group of computed.vatBreakdown) {
      if (
        EXEMPTION_CATEGORIES.includes(group.categoryCode) &&
        !group.exemptionReason &&
        !group.exemptionReasonCode
      ) {
        const message =
          `vatExemptions.${group.categoryCode} needs a reason or code (BT-120/BT-121) — ` +
          `category "${group.categoryCode}" requires an exemption justification`;
        if (level === 'en16931' || level === 'extended') errors.push(message);
        else warnings.push(message);
      }
    }
  } else if (invoice.totals) {
    const t = invoice.totals;
    if (Math.abs(t.taxBasis + t.tax - t.grand) > 0.005) {
      errors.push(
        `totals are inconsistent: taxBasis (${t.taxBasis}) + tax (${t.tax}) must equal grand (${t.grand}) (BR-CO-15)`,
      );
    }
    const prepaid = t.prepaid ?? 0;
    if (Math.abs(t.grand - prepaid - t.due) > 0.005) {
      errors.push(
        `totals are inconsistent: grand (${t.grand}) - prepaid (${prepaid}) must equal due (${t.due}) (BR-CO-16)`,
      );
    }
  }

  if (invoice.payment?.dueDate && !DATE_RE.test(invoice.payment.dueDate)) {
    errors.push(`payment.dueDate "${invoice.payment.dueDate}" must be formatted YYYY-MM-DD`);
  }
  if (invoice.deliveryDate && !DATE_RE.test(invoice.deliveryDate)) {
    errors.push(`deliveryDate "${invoice.deliveryDate}" must be formatted YYYY-MM-DD`);
  }

  return { errors, warnings };
}
