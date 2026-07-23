import { describe, expect, it } from 'vitest';
import { formatAmount, roundMoney } from '../src/money.js';
import { amountToXml } from '../src/money.js';

describe('roundMoney', () => {
  it('rounds to 2 decimals', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.674999)).toBe(2.67);
    expect(roundMoney(-1.005)).toBe(-1);
  });

  it('avoids floating point drift', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(amountToXml(19.9 * 3)).toBe('59.70');
  });
});

describe('formatAmount', () => {
  it('puts £ and $ before the amount for English locales', () => {
    expect(formatAmount(1234.5, 'GBP', 'en-GB')).toBe('£1,234.50');
    expect(formatAmount(1234.5, 'USD', 'en-US')).toBe('$1,234.50');
  });

  it('puts € after the amount for French locales', () => {
    const formatted = formatAmount(1234.5, 'EUR', 'fr-FR');
    expect(formatted.endsWith('€')).toBe(true);
    expect(formatted).toMatch(/^1[\s\u00A0\u202F]234,50/);
  });

  it('defaults to en-GB', () => {
    expect(formatAmount(99, 'EUR')).toBe('€99.00');
  });

  it('handles arbitrary ISO currencies', () => {
    expect(formatAmount(50, 'JPY', 'ja-JP')).toBe('￥50');
    expect(formatAmount(10, 'CHF', 'de-CH')).toContain('10.00');
  });
});
