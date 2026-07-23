import { AFRelationship, PDFArray, PDFDict, PDFName, type PDFDocument, type PDFRef } from 'pdf-lib';
import { LEVEL_XMP_NAMES } from '../levels.js';
import { escapeXml } from '../xml/writer.js';
import type { FacturXLevel, Invoice } from '../types.js';

export const FACTURX_FILENAME = 'factur-x.xml';

/**
 * Attach the Factur-X XML to the PDF the way the Factur-X 1.0 specification
 * requires: an embedded file with an AFRelationship, referenced from the
 * document catalog's /AF array, plus XMP metadata declaring PDF/A-3 and the
 * Factur-X extension schema (document type, filename, version, profile).
 */
export async function embedFacturX(
  doc: PDFDocument,
  xml: string,
  level: FacturXLevel,
  invoice: Invoice,
  now: Date = new Date(),
): Promise<void> {
  await doc.attach(new TextEncoder().encode(xml), FACTURX_FILENAME, {
    mimeType: 'text/xml',
    description: 'Factur-X electronic invoice data',
    creationDate: now,
    modificationDate: now,
    afRelationship: AFRelationship.Data,
  });

  const fileSpecRef = findEmbeddedFileSpecRef(doc, FACTURX_FILENAME);
  if (fileSpecRef) {
    doc.catalog.set(PDFName.of('AF'), doc.context.obj([fileSpecRef]));
  }

  const title = `Invoice ${invoice.number}`;
  doc.setTitle(title);
  doc.setAuthor(invoice.seller.name);
  doc.setSubject(`Factur-X invoice ${invoice.number} from ${invoice.seller.name}`);
  doc.setProducer('@canopynexus/factur-x');
  doc.setCreator('@canopynexus/factur-x');
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  const metadataStream = doc.context.stream(buildXmp(title, invoice.seller.name, level, now), {
    Type: 'Metadata',
    Subtype: 'XML',
  });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(metadataStream));
}

function findEmbeddedFileSpecRef(doc: PDFDocument, filename: string): PDFRef | undefined {
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const embedded = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const pairs = embedded?.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (!pairs) return undefined;
  for (let i = 0; i + 1 < pairs.size(); i += 2) {
    const name = pairs.lookup(i);
    if (name && 'decodeText' in name && typeof name.decodeText === 'function') {
      if ((name as { decodeText(): string }).decodeText() === filename) {
        return pairs.get(i + 1) as PDFRef;
      }
    }
  }
  return undefined;
}

function xmpDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function buildXmp(title: string, author: string, level: FacturXLevel, now: Date): string {
  const date = xmpDate(now);
  return `<?xpacket begin="${'\ufeff'}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(title)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${escapeXml(author)}</rdf:li></rdf:Seq></dc:creator>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>@canopynexus/factur-x</pdf:Producer>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>@canopynexus/factur-x</xmp:CreatorTool>
      <xmp:CreateDate>${date}</xmp:CreateDate>
      <xmp:ModifyDate>${date}</xmp:ModifyDate>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
        xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
        xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentFileName</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>Name of the embedded XML invoice file</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentType</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>INVOICE</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>Version</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The actual version of the Factur-X XML schema</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>ConformanceLevel</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The conformance level of the embedded Factur-X data</pdfaProperty:description>
                </rdf:li>
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${FACTURX_FILENAME}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>${LEVEL_XMP_NAMES[level]}</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}
