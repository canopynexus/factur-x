import { LEVEL_URNS, levelHasFullHeader, levelHasLines } from '../levels.js';
import { amountToXml } from '../money.js';
import { lineNetAmount, resolveTotals } from '../totals.js';
import type { FacturXLevel, Invoice, Party } from '../types.js';
import { el, serialize, type XmlNode } from './writer.js';

/** "YYYY-MM-DD" → CII date string with format 102 ("YYYYMMDD"). */
function dateNode(wrapper: string, isoDate: string): XmlNode {
  return el(wrapper, [el('udt:DateTimeString', { format: '102' }, isoDate.replaceAll('-', ''))]);
}

function partyNode(
  role: 'ram:SellerTradeParty' | 'ram:BuyerTradeParty',
  party: Party,
  level: FacturXLevel,
): XmlNode {
  const full = levelHasFullHeader(level);
  const address = party.address;
  const includeAddress = address && (full || role === 'ram:SellerTradeParty');
  return el(role, [
    el('ram:Name', party.name),
    party.legalId
      ? el('ram:SpecifiedLegalOrganization', [
          party.legalId.scheme
            ? el('ram:ID', { schemeID: party.legalId.scheme }, party.legalId.value)
            : el('ram:ID', party.legalId.value),
        ])
      : undefined,
    includeAddress
      ? el('ram:PostalTradeAddress', [
          full && address.postCode ? el('ram:PostcodeCode', address.postCode) : undefined,
          full && address.line1 ? el('ram:LineOne', address.line1) : undefined,
          full && address.line2 ? el('ram:LineTwo', address.line2) : undefined,
          full && address.city ? el('ram:CityName', address.city) : undefined,
          el('ram:CountryID', address.countryCode),
        ])
      : undefined,
    full && party.email
      ? el('ram:URIUniversalCommunication', [el('ram:URIID', { schemeID: 'EM' }, party.email)])
      : undefined,
    party.vatId
      ? el('ram:SpecifiedTaxRegistration', [el('ram:ID', { schemeID: 'VA' }, party.vatId)])
      : undefined,
  ]);
}

/**
 * Build the Factur-X (UN/CEFACT Cross Industry Invoice D16B) XML for an
 * invoice at the given profile level. The invoice is assumed valid — run
 * `validateInvoice` first.
 */
export function buildXml(invoice: Invoice, level: FacturXLevel): string {
  const totals = resolveTotals(invoice);
  if (!totals) throw new Error('cannot build XML without lines or totals');
  const full = levelHasFullHeader(level);
  const withLines = levelHasLines(level);
  const payment = invoice.payment;

  const lineItems = withLines
    ? (invoice.lines ?? []).map((line, index) =>
        el('ram:IncludedSupplyChainTradeLineItem', [
          el('ram:AssociatedDocumentLineDocument', [
            el('ram:LineID', line.id ?? String(index + 1)),
          ]),
          el('ram:SpecifiedTradeProduct', [
            el('ram:Name', line.name),
            line.description ? el('ram:Description', line.description) : undefined,
          ]),
          el('ram:SpecifiedLineTradeAgreement', [
            el('ram:NetPriceProductTradePrice', [
              el('ram:ChargeAmount', amountToXml(line.unitPrice)),
            ]),
          ]),
          el('ram:SpecifiedLineTradeDelivery', [
            el('ram:BilledQuantity', { unitCode: line.unit ?? 'C62' }, String(line.quantity)),
          ]),
          el('ram:SpecifiedLineTradeSettlement', [
            el('ram:ApplicableTradeTax', [
              el('ram:TypeCode', 'VAT'),
              el('ram:CategoryCode', line.vat.categoryCode),
              line.vat.rate !== undefined
                ? el('ram:RateApplicablePercent', String(line.vat.rate))
                : undefined,
            ]),
            el('ram:SpecifiedTradeSettlementLineMonetarySummation', [
              el('ram:LineTotalAmount', amountToXml(lineNetAmount(line))),
            ]),
          ]),
        ]),
      )
    : [];

  const vatBreakdown = full
    ? totals.vatBreakdown.map((group) =>
        el('ram:ApplicableTradeTax', [
          el('ram:CalculatedAmount', amountToXml(group.tax)),
          el('ram:TypeCode', 'VAT'),
          group.exemptionReason ? el('ram:ExemptionReason', group.exemptionReason) : undefined,
          el('ram:BasisAmount', amountToXml(group.basis)),
          el('ram:CategoryCode', group.categoryCode),
          group.exemptionReasonCode
            ? el('ram:ExemptionReasonCode', group.exemptionReasonCode)
            : undefined,
          el('ram:RateApplicablePercent', String(group.rate)),
        ]),
      )
    : [];

  const root = el(
    'rsm:CrossIndustryInvoice',
    {
      'xmlns:rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
      'xmlns:ram':
        'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
      'xmlns:qdt': 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
      'xmlns:udt': 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    },
    [
      el('rsm:ExchangedDocumentContext', [
        el('ram:GuidelineSpecifiedDocumentContextParameter', [el('ram:ID', LEVEL_URNS[level])]),
      ]),
      el('rsm:ExchangedDocument', [
        el('ram:ID', invoice.number),
        el('ram:TypeCode', invoice.typeCode ?? '380'),
        dateNode('ram:IssueDateTime', invoice.issueDate),
        ...(full
          ? (invoice.notes ?? []).map((note) => el('ram:IncludedNote', [el('ram:Content', note)]))
          : []),
      ]),
      el('rsm:SupplyChainTradeTransaction', [
        ...lineItems,
        el('ram:ApplicableHeaderTradeAgreement', [
          invoice.buyerReference ? el('ram:BuyerReference', invoice.buyerReference) : undefined,
          partyNode('ram:SellerTradeParty', invoice.seller, level),
          partyNode('ram:BuyerTradeParty', invoice.buyer, level),
          invoice.purchaseOrderReference
            ? el('ram:BuyerOrderReferencedDocument', [
                el('ram:IssuerAssignedID', invoice.purchaseOrderReference),
              ])
            : undefined,
        ]),
        el(
          'ram:ApplicableHeaderTradeDelivery',
          full && invoice.deliveryDate
            ? [
                el('ram:ActualDeliverySupplyChainEvent', [
                  dateNode('ram:OccurrenceDateTime', invoice.deliveryDate),
                ]),
              ]
            : [],
        ),
        el('ram:ApplicableHeaderTradeSettlement', [
          full && payment?.reference ? el('ram:PaymentReference', payment.reference) : undefined,
          el('ram:InvoiceCurrencyCode', invoice.currency),
          full && (payment?.iban || payment?.meansTypeCode)
            ? el('ram:SpecifiedTradeSettlementPaymentMeans', [
                el('ram:TypeCode', payment.meansTypeCode ?? '30'),
                payment.iban
                  ? el('ram:PayeePartyCreditorFinancialAccount', [el('ram:IBANID', payment.iban)])
                  : undefined,
                payment.bic
                  ? el('ram:PayeeSpecifiedCreditorFinancialInstitution', [
                      el('ram:BICID', payment.bic),
                    ])
                  : undefined,
              ])
            : undefined,
          ...vatBreakdown,
          full && (payment?.terms || payment?.dueDate)
            ? el('ram:SpecifiedTradePaymentTerms', [
                payment.terms ? el('ram:Description', payment.terms) : undefined,
                payment.dueDate ? dateNode('ram:DueDateDateTime', payment.dueDate) : undefined,
              ])
            : undefined,
          el('ram:SpecifiedTradeSettlementHeaderMonetarySummation', [
            full ? el('ram:LineTotalAmount', amountToXml(totals.lineTotal)) : undefined,
            el('ram:TaxBasisTotalAmount', amountToXml(totals.taxBasis)),
            el('ram:TaxTotalAmount', { currencyID: invoice.currency }, amountToXml(totals.tax)),
            el('ram:GrandTotalAmount', amountToXml(totals.grand)),
            totals.prepaid !== 0
              ? el('ram:TotalPrepaidAmount', amountToXml(totals.prepaid))
              : undefined,
            el('ram:DuePayableAmount', amountToXml(totals.due)),
          ]),
        ]),
      ]),
    ],
  );

  return serialize(root);
}
