import type { FacturXLevel } from './types.js';

/** Guideline URNs (BT-24) for Factur-X 1.0 / ZUGFeRD 2.x profiles. */
export const LEVEL_URNS: Record<FacturXLevel, string> = {
  minimum: 'urn:factur-x.eu:1p0:minimum',
  basicwl: 'urn:factur-x.eu:1p0:basicwl',
  basic: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic',
  en16931: 'urn:cen.eu:en16931:2017',
  extended: 'urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended',
};

/** Conformance level strings used in the PDF XMP metadata. */
export const LEVEL_XMP_NAMES: Record<FacturXLevel, string> = {
  minimum: 'MINIMUM',
  basicwl: 'BASIC WL',
  basic: 'BASIC',
  en16931: 'EN 16931',
  extended: 'EXTENDED',
};

export const ALL_LEVELS: readonly FacturXLevel[] = [
  'minimum',
  'basicwl',
  'basic',
  'en16931',
  'extended',
];

/** Guideline URN → level, including ZUGFeRD 2.x aliases sharing the same URNs. */
export function levelFromGuideline(urn: string): FacturXLevel | undefined {
  const normalized = urn.trim().toLowerCase();
  for (const level of ALL_LEVELS) {
    if (LEVEL_URNS[level].toLowerCase() === normalized) return level;
  }
  // ZUGFeRD 2.x EXTENDED historically used the zugferd namespace in the URN.
  if (normalized === 'urn:cen.eu:en16931:2017#conformant#urn:zugferd.de:2p0:extended') {
    return 'extended';
  }
  if (normalized === 'urn:zugferd.de:2p0:minimum') return 'minimum';
  if (normalized === 'urn:zugferd.de:2p0:basicwl') return 'basicwl';
  if (normalized === 'urn:cen.eu:en16931:2017#compliant#urn:zugferd.de:2p0:basic') return 'basic';
  return undefined;
}

/** True when `level` includes invoice lines in the XML. */
export function levelHasLines(level: FacturXLevel): boolean {
  return level === 'basic' || level === 'en16931' || level === 'extended';
}

/** True when `level` carries the full header (parties' addresses, VAT breakdown, payment). */
export function levelHasFullHeader(level: FacturXLevel): boolean {
  return level !== 'minimum';
}
