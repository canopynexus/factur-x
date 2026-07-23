/**
 * Factur-X profile ("level") identifiers, from least to most detailed.
 *
 * - `minimum`  — header identification + totals only (not a full invoice under EN 16931)
 * - `basicwl`  — "BASIC without lines": full header, VAT breakdown, no line items
 * - `basic`    — BASIC WL + line items; EN 16931 compliant subset
 * - `en16931`  — the full EN 16931 semantic model
 * - `extended` — EN 16931 + Factur-X extensions
 */
export type FacturXLevel = 'minimum' | 'basicwl' | 'basic' | 'en16931' | 'extended';

/** UNTDID 5305 VAT category codes used by EN 16931. */
export type VatCategoryCode =
  | 'S' // standard rate
  | 'Z' // zero-rated
  | 'E' // exempt
  | 'AE' // reverse charge
  | 'K' // intra-community supply (exempt)
  | 'G' // export outside the EU (exempt)
  | 'O' // not subject to VAT
  | 'L' // Canary Islands IGIC
  | 'M'; // Ceuta & Melilla IPSI

export interface PostalAddress {
  line1?: string;
  line2?: string;
  postCode?: string;
  city?: string;
  /** ISO 3166-1 alpha-2, e.g. "FR". */
  countryCode: string;
}

export interface Party {
  name: string;
  /**
   * National legal registration, e.g. a French SIREN (`scheme: "0002"`) or a UK
   * Companies House number (`scheme: "0060"`).
   */
  legalId?: { value: string; scheme?: string };
  /** VAT identifier including country prefix, e.g. "FR40123456824". */
  vatId?: string;
  address?: PostalAddress;
  email?: string;
}

export interface LineVat {
  categoryCode: VatCategoryCode;
  /** Percentage, e.g. 20 for 20 %. Required for category "S". */
  rate?: number;
}

export interface InvoiceLine {
  /** Line identifier; defaults to its 1-based position. */
  id?: string;
  name: string;
  description?: string;
  quantity: number;
  /** UN/ECE Recommendation 20 unit code; defaults to "C62" (unit). */
  unit?: string;
  /** Net unit price (excluding VAT). */
  unitPrice: number;
  vat: LineVat;
}

export interface PaymentDetails {
  /** UNTDID 4461, e.g. "30" credit transfer, "58" SEPA credit transfer. */
  meansTypeCode?: string;
  iban?: string;
  bic?: string;
  /** Remittance information / payment reference. */
  reference?: string;
  terms?: string;
  /** "YYYY-MM-DD". */
  dueDate?: string;
}

export interface InvoiceTotals {
  /** Sum of line net amounts. */
  lineTotal?: number;
  /** Total VAT basis (invoice total without VAT). */
  taxBasis: number;
  /** Total VAT amount. */
  tax: number;
  /** Invoice total including VAT. */
  grand: number;
  prepaid?: number;
  /** Amount due for payment. */
  due: number;
}

/** Free-text reason (and/or VATEX code) justifying a non-standard VAT category. */
export interface VatExemption {
  reason?: string;
  /** VATEX code, e.g. "VATEX-EU-IC". */
  code?: string;
}

export interface Invoice {
  /** Invoice number (BT-1). */
  number: string;
  /** UNTDID 1001 document type; defaults to "380" (commercial invoice). */
  typeCode?: string;
  /** "YYYY-MM-DD" (BT-2). */
  issueDate: string;
  /** ISO 4217 currency code (BT-5), e.g. "EUR", "GBP", "USD". */
  currency: string;
  seller: Party;
  buyer: Party;
  /** Buyer reference (BT-10) — mandatory for French B2G (Chorus Pro "service code"). */
  buyerReference?: string;
  /** Purchase order reference (BT-13). */
  purchaseOrderReference?: string;
  /** "YYYY-MM-DD" (BT-72). */
  deliveryDate?: string;
  /**
   * Invoice lines. Required for every level except `minimum` — the `basicwl`
   * profile omits them from the XML but still needs them to compute the
   * document-level VAT breakdown.
   */
  lines?: InvoiceLine[];
  /** Exemption reasons per VAT category (required for E, AE, K, G at EN 16931 level). */
  vatExemptions?: Partial<Record<VatCategoryCode, VatExemption>>;
  payment?: PaymentDetails;
  notes?: string[];
  /**
   * Explicit totals. Required when `lines` is absent; otherwise totals are
   * computed from the lines and, if also provided here, cross-checked.
   */
  totals?: InvoiceTotals;
}

export interface CreateOptions {
  level: FacturXLevel;
  /** "pdf" (default) embeds the XML in a hybrid PDF; "xml" returns XML only. */
  format?: 'pdf' | 'xml';
  /**
   * BCP 47 locale used to format amounts on the rendered PDF, e.g. "fr-FR"
   * (1 234,56 €) or "en-GB" (£1,234.56). Defaults to "en-GB".
   */
  locale?: string;
  /** Timestamp used in PDF metadata; defaults to `new Date()`. */
  now?: Date;
}

export interface CreateResult {
  xml: string;
  /** Present when `format` is "pdf". */
  pdf?: Uint8Array;
  warnings: string[];
}

export type VerifySource = 'xml' | 'pdf';

export type VerifyResult =
  | {
      valid: true;
      level: FacturXLevel;
      /** The guideline URN found in the XML. */
      guidelineId: string;
      source: VerifySource;
      xml: string;
      warnings: string[];
    }
  | {
      valid: false;
      source: VerifySource | 'unknown';
      errors: string[];
    };

export interface ExtractResult {
  xml: string;
  /** Name of the embedded file, normally "factur-x.xml". */
  filename: string;
}
