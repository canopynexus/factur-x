# Factur-x

Create, verify and extract **Factur-X / ZUGFeRD** electronic invoices in TypeScript — the Franco-German hybrid e-invoicing standard built on **EN 16931**, where a human-readable PDF carries the machine-readable UN/CEFACT Cross Industry Invoice (CII) XML inside it.

Maintained by [Canopy Nexus Ltd](https://canopynexus.com) as an open-source implementation of the standard now rolling out across Europe.

- **Factur-X** — official specification: <https://fnfe-mpe.org/factur-x/>
- **ZUGFeRD** — the German twin standard: <https://www.ferd-net.de/standards/zugferd/>
- **EN 16931** — the European semantic model: <https://ec.europa.eu/digital-building-blocks/sites/spaces/DIGITAL/pages/467108926/Compliance+with+eInvoicing+standard>

## Install

```sh
npm install @canopynexus/factur-x
```

Ships ESM and CJS bundles with TypeScript declarations. Node ≥ 20.

## API

Three functions: `create`, `verify`, `extract`.

### create

```ts
import { create } from '@canopynexus/factur-x';

const invoice = {
  number: 'FA-2026-0001',
  issueDate: '2026-07-01',
  currency: 'EUR',
  seller: {
    name: 'Reblochon SARL',
    vatId: 'FR32532198476',
    legalId: { value: '532198476', scheme: '0002' }, // SIREN
    address: {
      line1: '12 route des Alpages',
      postCode: '74230',
      city: 'Thônes',
      countryCode: 'FR',
    },
  },
  buyer: {
    name: 'Acme France SAS',
    vatId: 'FR90410108494',
    address: { line1: '1 rue de la Paix', postCode: '75002', city: 'Paris', countryCode: 'FR' },
  },
  lines: [
    {
      name: 'Reblochon fermier AOP',
      quantity: 40,
      unit: 'H87', // piece
      unitPrice: 6.9,
      vat: { categoryCode: 'S', rate: 5.5 },
    },
  ],
  payment: { iban: 'FR7630006000011234567890189', dueDate: '2026-08-01' },
};

// Hybrid PDF with embedded factur-x.xml (the default)
const { pdf, xml } = await create(invoice, { level: 'en16931', locale: 'fr-FR' });

// XML only
const { xml: xmlOnly } = await create(invoice, { level: 'basic', format: 'xml' });
```

The invoice object is validated against the requested level before anything is generated; a `FacturXValidationError` lists every problem at once. Totals and the VAT breakdown (BG-23) are computed from the lines — if you also pass `totals`, they are cross-checked.

### verify

Accepts CII XML (string or bytes) **or** a hybrid PDF. Finds the XML, checks it is a Factur-X invoice, and reports the profile level.

```ts
import { verify } from '@canopynexus/factur-x';

const result = await verify(await readFile('invoice.pdf'));
if (result.valid) {
  console.log(result.level); // 'minimum' | 'basicwl' | 'basic' | 'en16931' | 'extended'
  console.log(result.guidelineId); // e.g. 'urn:cen.eu:en16931:2017'
  console.log(result.source); // 'pdf' or 'xml'
} else {
  console.error(result.errors); // what is missing or inconsistent
}
```

Verification checks the guideline URN (BT-24), the mandatory terms of the detected profile, and arithmetic consistency of the monetary summation, line totals and VAT breakdown (BR-CO-10/14/15/16).

### extract

```ts
import { extract } from '@canopynexus/factur-x';

const { xml, filename } = await extract(await readFile('invoice.pdf'));
```

Understands `factur-x.xml` and the ZUGFeRD attachment names.

## Factur-X levels

| Level      | Guideline URN (BT-24)                                             | Contents                                 |
| ---------- | ----------------------------------------------------------------- | ---------------------------------------- |
| `minimum`  | `urn:factur-x.eu:1p0:minimum`                                     | Identification + totals only             |
| `basicwl`  | `urn:factur-x.eu:1p0:basicwl`                                     | Full header, VAT breakdown, **no** lines |
| `basic`    | `urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic`     | BASIC WL + invoice lines                 |
| `en16931`  | `urn:cen.eu:en16931:2017`                                         | The full EN 16931 semantic model         |
| `extended` | `urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended` | EN 16931 + Factur-X extensions           |

The same invoice object can be emitted at any level — `basicwl` uses the lines to compute the VAT breakdown but leaves them out of the XML.

## Command line

```sh
npm run build   # once — the CLI runs from dist/

npx facturx create examples/en16931-domestic-vat.json          # → .pdf next to the JSON
npx facturx create invoice.json --level basic --format xml -o invoice.xml
npx facturx verify invoice.pdf
npx facturx extract invoice.pdf -o factur-x.xml
npx facturx batch examples --out-dir out                       # generate every example
```

Invoice JSON files may embed defaults under `"$options"` (`level`, `format`, `locale`); command-line flags override them.

## Examples

The [examples/](examples/) directory covers the VAT situations European sellers actually meet - starring **Reblochon SARL**, a Haute-Savoie cheese maker, invoicing various **Acme** entities:

| Example                                                         | Scenario                                             | Level      | Currency |
| --------------------------------------------------------------- | ---------------------------------------------------- | ---------- | -------- |
| [minimum.json](examples/minimum.json)                           | Totals-only skeleton invoice                         | `minimum`  | EUR      |
| [basicwl-services.json](examples/basicwl-services.json)         | Monthly service, no lines in XML                     | `basicwl`  | EUR      |
| [basic-domestic-vat.json](examples/basic-domestic-vat.json)     | Domestic sale, reduced food VAT 5.5 %                | `basic`    | EUR      |
| [en16931-domestic-vat.json](examples/en16931-domestic-vat.json) | Mixed 5.5 % / 20 % rates, discount terms             | `en16931`  | EUR      |
| [extended-full.json](examples/extended-full.json)               | Deposit received, prepaid amount deducted            | `extended` | EUR      |
| [intra-eu-supply.json](examples/intra-eu-supply.json)           | Intra-EU supply to Germany, category K, VATEX-EU-IC  | `en16931`  | EUR      |
| [export-outside-eu.json](examples/export-outside-eu.json)       | Export to the USA, category G, billed in dollars     | `en16931`  | USD      |
| [export-uk-gbp.json](examples/export-uk-gbp.json)               | Post-Brexit export to the UK, billed in sterling     | `en16931`  | GBP      |
| [non-vat-franchise.json](examples/non-vat-franchise.json)       | Seller under the French _franchise en base_ (no VAT) | `en16931`  | EUR      |

## Currency display

Amounts on the PDF are formatted with `Intl.NumberFormat`, so the symbol lands where the locale puts it — leading or trailing, whatever the currency:

```ts
import { formatAmount } from '@canopynexus/factur-x';

formatAmount(1234.5, 'GBP', 'en-GB'); // £1,234.50
formatAmount(1234.5, 'EUR', 'fr-FR'); // 1 234,50 €
formatAmount(1234.5, 'USD', 'en-US'); // $1,234.50
```

Pass `locale` in `CreateOptions` (default `en-GB`) to control how the PDF renders amounts.

## Compliance notes & roadmap

The generated PDF embeds the XML the way the Factur-X specification requires: an `AFRelationship`-tagged embedded file referenced from the catalog's `/AF` array, plus XMP metadata declaring PDF/A-3 identification and the Factur-X extension schema (`fx:DocumentFileName`, `fx:ConformanceLevel`, …).

Honest limitations of this first version, and where it goes next:

- **PDF/A-3 completeness** — the standard-14 fonts are not embedded and there is no ICC
  output intent yet, so strict PDF/A-3 validators (veraPDF) will flag the file even though every consuming platform can read the invoice. Full PDF/A-3b output is the top roadmap item.
- **Schematron validation** — `verify` enforces structure, profile membership and the
  arithmetic business rules, not the complete EN 16931 Schematron rule set. Wiring in the official rules is planned.
- **Invoice styling** — the PDF layout is deliberately simple; a CSS-like theming layer so users can customise their invoices is planned.
- **XRechnung / UBL** — detection hooks exist for guideline URNs; full support later.

## Development

```sh
npm install
npm test              # vitest
npm run check-types   # TypeScript 7 (native) — see note below
npm run lint          # ESLint 10 + typescript-eslint
npm run build         # vite (ESM + CJS) + d.ts via TypeScript 7
npm run examples      # regenerate out/ from examples/
```

**TypeScript toolchain note:** compiling, type-checking and declaration emit run on **TypeScript 7** (the native compiler), installed under the `typescript7` alias. The root `typescript` dependency is pinned to 6.x only because `typescript-eslint` (and editor tooling) still needs the JS compiler API, which the native package no longer ships. When
typescript-eslint supports TS 7, the 6.x shim goes away.

## License

MIT © Canopy Nexus Ltd

A copy of the license is available in the repository's [LICENSE](LICENSE.md) file.
