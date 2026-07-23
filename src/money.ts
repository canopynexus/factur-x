/** Round to 2 decimals, avoiding IEEE 754 artefacts on values like 1.005. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Fixed 2-decimal string as required for CII amount elements. */
export function amountToXml(value: number): string {
  return roundMoney(value).toFixed(2);
}

/**
 * Locale-aware currency formatting. The locale decides whether the symbol
 * leads or trails: `formatAmount(1234.5, 'EUR', 'fr-FR')` → "1 234,50 €",
 * `formatAmount(1234.5, 'GBP', 'en-GB')` → "£1,234.50",
 * `formatAmount(1234.5, 'USD', 'en-US')` → "$1,234.50".
 */
export function formatAmount(value: number, currency: string, locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(value);
}
