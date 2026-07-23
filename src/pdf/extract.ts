import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';
import { FacturXError } from '../errors.js';
import type { ExtractResult } from '../types.js';

/** Embedded-file names recognised as e-invoice payloads, in preference order. */
const KNOWN_NAMES = ['factur-x.xml', 'zugferd-invoice.xml', 'ZUGFeRD-invoice.xml', 'xrechnung.xml'];

interface Attachment {
  filename: string;
  bytes: Uint8Array;
}

/** Extract the embedded Factur-X / ZUGFeRD XML from a PDF's bytes. */
export async function extractXmlFromPdf(pdf: Uint8Array): Promise<ExtractResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  } catch (cause) {
    throw new FacturXError(
      `could not parse PDF: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const attachments = collectAttachments(doc);
  if (attachments.length === 0) {
    throw new FacturXError('no embedded files found in the PDF — not a hybrid Factur-X invoice');
  }

  const match =
    attachments.find((a) => KNOWN_NAMES.includes(a.filename)) ??
    attachments.find((a) => a.filename.toLowerCase().endsWith('.xml'));
  if (!match) {
    throw new FacturXError(
      `no XML invoice attachment found; embedded files: ${attachments
        .map((a) => a.filename)
        .join(', ')}`,
    );
  }

  return { xml: new TextDecoder('utf-8').decode(match.bytes), filename: match.filename };
}

function collectAttachments(doc: PDFDocument): Attachment[] {
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const embedded = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  if (!embedded) return [];
  const out: Attachment[] = [];
  walkNameTree(embedded, out);
  return out;
}

function walkNameTree(node: PDFDict, out: Attachment[]): void {
  const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
  if (kids) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookup(i);
      if (kid instanceof PDFDict) walkNameTree(kid, out);
    }
  }
  const pairs = node.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (!pairs) return;
  for (let i = 0; i + 1 < pairs.size(); i += 2) {
    const name = pairs.lookup(i);
    const spec = pairs.lookup(i + 1);
    if (!(spec instanceof PDFDict)) continue;
    const filename = decodeName(spec) ?? decodeString(name);
    const bytes = readEmbeddedBytes(spec);
    if (filename && bytes) out.push({ filename, bytes });
  }
}

function decodeName(spec: PDFDict): string | undefined {
  const uf = spec.lookupMaybe(PDFName.of('UF'), PDFString, PDFHexString);
  if (uf) return uf.decodeText();
  const f = spec.lookupMaybe(PDFName.of('F'), PDFString, PDFHexString);
  return f?.decodeText();
}

function decodeString(value: unknown): string | undefined {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return undefined;
}

function readEmbeddedBytes(spec: PDFDict): Uint8Array | undefined {
  const ef = spec.lookupMaybe(PDFName.of('EF'), PDFDict);
  const stream =
    ef?.lookupMaybe(PDFName.of('UF'), PDFStream) ?? ef?.lookupMaybe(PDFName.of('F'), PDFStream);
  if (!stream) return undefined;
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  return stream.getContents();
}
