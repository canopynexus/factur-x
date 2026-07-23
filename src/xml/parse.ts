import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { levelFromGuideline, levelHasFullHeader, levelHasLines } from '../levels.js';
import type { FacturXLevel } from '../types.js';

export interface XmlCheckResult {
  level?: FacturXLevel;
  guidelineId?: string;
  errors: string[];
  warnings: string[];
}

type Node = Record<string, unknown>;

function asArray(value: unknown): Node[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as Node[];
}

function child(node: unknown, name: string): unknown {
  if (node === null || typeof node !== 'object') return undefined;
  return (node as Node)[name];
}

function path(node: unknown, ...names: string[]): unknown {
  let current = node;
  for (const name of names) {
    current = child(current, name);
    if (current === undefined) return undefined;
  }
  return current;
}

function text(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'object') {
    const inner = (node as Node)['#text'];
    return inner === undefined ? undefined : String(inner);
  }
  return String(node);
}

function amount(node: unknown): number | undefined {
  const raw = text(node);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isNaN(value) ? undefined : value;
}

const TOLERANCE = 0.011;

/**
 * Structurally check a Factur-X / ZUGFeRD CII XML document: guideline URN,
 * mandatory terms for the detected profile, and arithmetic consistency of the
 * monetary summation (BR-CO-13/15/16 style checks).
 */
export function checkXml(xml: string): XmlCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const wellFormed = XMLValidator.validate(xml);
  if (wellFormed !== true) {
    return { errors: [`XML is not well-formed: ${wellFormed.err.msg}`], warnings };
  }

  const parsed: unknown = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
  }).parse(xml);

  const invoice = child(parsed, 'CrossIndustryInvoice');
  if (!invoice) {
    return {
      errors: ['not a Cross Industry Invoice: root element rsm:CrossIndustryInvoice not found'],
      warnings,
    };
  }

  const guidelineId = text(
    path(invoice, 'ExchangedDocumentContext', 'GuidelineSpecifiedDocumentContextParameter', 'ID'),
  );
  if (!guidelineId) {
    return {
      errors: ['guideline identifier (BT-24) not found in ExchangedDocumentContext'],
      warnings,
    };
  }
  const level = levelFromGuideline(guidelineId);
  if (!level) {
    return {
      guidelineId,
      errors: [`guideline "${guidelineId}" is not a known Factur-X / ZUGFeRD profile`],
      warnings,
    };
  }

  const doc = child(invoice, 'ExchangedDocument');
  if (!text(path(doc, 'ID'))) errors.push('invoice number (BT-1) is missing');
  const issueDate = text(path(doc, 'IssueDateTime', 'DateTimeString'));
  if (!issueDate) errors.push('issue date (BT-2) is missing');
  else if (!/^\d{8}$/.test(issueDate)) {
    errors.push(`issue date "${issueDate}" is not in format 102 (YYYYMMDD)`);
  }

  const transaction = child(invoice, 'SupplyChainTradeTransaction');
  const agreement = child(transaction, 'ApplicableHeaderTradeAgreement');
  const seller = child(agreement, 'SellerTradeParty');
  if (!text(path(seller, 'Name'))) errors.push('seller name (BT-27) is missing');
  if (!text(path(seller, 'PostalTradeAddress', 'CountryID'))) {
    errors.push('seller country (BT-40) is missing');
  }
  if (!text(path(agreement, 'BuyerTradeParty', 'Name'))) {
    errors.push('buyer name (BT-44) is missing');
  }

  const settlement = child(transaction, 'ApplicableHeaderTradeSettlement');
  if (!text(path(settlement, 'InvoiceCurrencyCode'))) {
    errors.push('invoice currency (BT-5) is missing');
  }

  const summation = child(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  const taxBasis = amount(path(summation, 'TaxBasisTotalAmount'));
  const tax = amount(path(summation, 'TaxTotalAmount')) ?? 0;
  const grand = amount(path(summation, 'GrandTotalAmount'));
  const prepaid = amount(path(summation, 'TotalPrepaidAmount')) ?? 0;
  const due = amount(path(summation, 'DuePayableAmount'));
  if (taxBasis === undefined) errors.push('TaxBasisTotalAmount (BT-109) is missing');
  if (grand === undefined) errors.push('GrandTotalAmount (BT-112) is missing');
  if (due === undefined) errors.push('DuePayableAmount (BT-115) is missing');
  if (taxBasis !== undefined && grand !== undefined) {
    if (Math.abs(taxBasis + tax - grand) > TOLERANCE) {
      errors.push(
        `totals are inconsistent (BR-CO-15): ${taxBasis} + ${tax} VAT ≠ ${grand} grand total`,
      );
    }
  }
  if (grand !== undefined && due !== undefined && Math.abs(grand - prepaid - due) > TOLERANCE) {
    errors.push(`totals are inconsistent (BR-CO-16): ${grand} - ${prepaid} prepaid ≠ ${due} due`);
  }

  const lines = asArray(child(transaction, 'IncludedSupplyChainTradeLineItem'));
  if (levelHasLines(level)) {
    if (lines.length === 0) {
      errors.push(`profile "${level}" requires invoice lines, none found (BG-25)`);
    } else {
      const lineSum = lines.reduce(
        (sum, line) =>
          sum +
          (amount(
            path(
              line,
              'SpecifiedLineTradeSettlement',
              'SpecifiedTradeSettlementLineMonetarySummation',
              'LineTotalAmount',
            ),
          ) ?? 0),
        0,
      );
      const lineTotal = amount(path(summation, 'LineTotalAmount'));
      if (lineTotal !== undefined && Math.abs(lineSum - lineTotal) > TOLERANCE) {
        errors.push(
          `line totals are inconsistent (BR-CO-10): lines add up to ${lineSum.toFixed(2)} ` +
            `but LineTotalAmount is ${lineTotal}`,
        );
      }
    }
  } else if (lines.length > 0) {
    errors.push(`profile "${level}" must not contain invoice lines, found ${lines.length}`);
  }

  if (levelHasFullHeader(level)) {
    const vatGroups = asArray(child(settlement, 'ApplicableTradeTax'));
    if (vatGroups.length === 0) {
      errors.push(`profile "${level}" requires a VAT breakdown (BG-23), none found`);
    } else {
      const vatSum = vatGroups.reduce(
        (sum, group) => sum + (amount(path(group, 'CalculatedAmount')) ?? 0),
        0,
      );
      if (Math.abs(vatSum - tax) > TOLERANCE) {
        errors.push(
          `VAT breakdown is inconsistent (BR-CO-14): categories add up to ${vatSum.toFixed(2)} ` +
            `but TaxTotalAmount is ${tax}`,
        );
      }
    }
    if (!text(path(agreement, 'BuyerTradeParty', 'PostalTradeAddress', 'CountryID'))) {
      warnings.push('buyer country (BT-55) is missing');
    }
  }

  return { level, guidelineId, errors, warnings };
}
