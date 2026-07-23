import { FacturXValidationError } from './errors.js';
import { embedFacturX } from './pdf/embed.js';
import { extractXmlFromPdf } from './pdf/extract.js';
import { renderPdf } from './pdf/render.js';
import { validateInvoice } from './validate.js';
import { buildXml } from './xml/build.js';
import { checkXml } from './xml/parse.js';
import type { CreateOptions, CreateResult, ExtractResult, Invoice, VerifyResult } from './types.js';

/**
 * Create a Factur-X invoice at the requested profile level.
 *
 * With `format: "pdf"` (the default) the result contains a hybrid PDF with
 * the XML embedded as `factur-x.xml`; with `format: "xml"` only the CII XML
 * is produced. Throws {@link FacturXValidationError} when the invoice does not
 * satisfy the requested level.
 */
export async function create(invoice: Invoice, options: CreateOptions): Promise<CreateResult> {
  const { errors, warnings } = validateInvoice(invoice, options.level);
  if (errors.length > 0) throw new FacturXValidationError(errors, warnings);

  const xml = buildXml(invoice, options.level);
  if ((options.format ?? 'pdf') === 'xml') return { xml, warnings };

  const doc = await renderPdf(invoice, options);
  await embedFacturX(doc, xml, options.level, invoice, options.now);
  return { xml, pdf: await doc.save(), warnings };
}

const PDF_MAGIC = '%PDF-';

function isPdf(input: Uint8Array | string): boolean {
  if (typeof input === 'string') return input.startsWith(PDF_MAGIC);
  const head = new TextDecoder('latin1').decode(input.subarray(0, PDF_MAGIC.length));
  return head === PDF_MAGIC;
}

/**
 * Verify that the input — CII XML, or a PDF with an embedded XML — is a
 * Factur-X invoice. On success reports the profile level found; on failure
 * lists what is missing or inconsistent.
 */
export async function verify(input: Uint8Array | string): Promise<VerifyResult> {
  let xml: string;
  let source: 'xml' | 'pdf';

  if (isPdf(input)) {
    source = 'pdf';
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    try {
      xml = (await extractXmlFromPdf(bytes)).xml;
    } catch (cause) {
      return {
        valid: false,
        source,
        errors: [cause instanceof Error ? cause.message : String(cause)],
      };
    }
  } else {
    source = 'xml';
    xml = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input);
    if (!xml.trimStart().startsWith('<')) {
      return { valid: false, source: 'unknown', errors: ['input is neither a PDF nor XML'] };
    }
  }

  const result = checkXml(xml);
  if (!result.level || result.errors.length > 0) {
    return { valid: false, source, errors: result.errors };
  }
  return {
    valid: true,
    level: result.level,
    guidelineId: result.guidelineId ?? '',
    source,
    xml,
    warnings: result.warnings,
  };
}

/** Extract the embedded Factur-X XML from a hybrid PDF. */
export async function extract(pdf: Uint8Array): Promise<ExtractResult> {
  return extractXmlFromPdf(pdf);
}
