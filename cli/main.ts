import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { create, extract, verify } from '../src/index.js';
import { ALL_LEVELS } from '../src/levels.js';
import type { CreateOptions, FacturXLevel, Invoice } from '../src/types.js';

const USAGE = `facturx — create, verify and extract Factur-X e-invoices

Usage:
  facturx create <invoice.json> [--level <level>] [--format pdf|xml] [--locale <bcp47>] [-o <file>]
  facturx verify <file.pdf|file.xml>
  facturx extract <file.pdf> [-o <file.xml>]
  facturx batch <dir> [--out-dir <dir>]

Levels: ${ALL_LEVELS.join(', ')}

Invoice JSON files may carry a "$options" object ({"level", "format", "locale"})
providing defaults that the command-line flags override.
`;

interface InvoiceFile extends Invoice {
  $options?: Partial<Pick<CreateOptions, 'level' | 'format' | 'locale'>>;
}

class CliError extends Error {}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'create':
        return await cmdCreate(rest);
      case 'verify':
        return await cmdVerify(rest);
      case 'extract':
        return await cmdExtract(rest);
      case 'batch':
        return await cmdBatch(rest);
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        process.stdout.write(USAGE);
        return command === undefined ? 2 : 0;
      default:
        throw new CliError(`unknown command "${command}"\n\n${USAGE}`);
    }
  } catch (cause) {
    if (cause instanceof CliError) {
      process.stderr.write(`error: ${cause.message}\n`);
      return 2;
    }
    process.stderr.write(`error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 1;
  }
}

async function readInvoiceFile(path: string): Promise<InvoiceFile> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    throw new CliError(`cannot read ${path}`);
  }
  try {
    return JSON.parse(raw) as InvoiceFile;
  } catch (cause) {
    throw new CliError(`${path} is not valid JSON: ${(cause as Error).message}`);
  }
}

function parseLevel(value: string | undefined): FacturXLevel | undefined {
  if (value === undefined) return undefined;
  if (!(ALL_LEVELS as string[]).includes(value)) {
    throw new CliError(`unknown level "${value}" (expected ${ALL_LEVELS.join(', ')})`);
  }
  return value as FacturXLevel;
}

async function createFromFile(
  path: string,
  overrides: { level?: string; format?: string; locale?: string },
  explicitOut?: string,
): Promise<string> {
  const { $options, ...invoice } = await readInvoiceFile(path);
  const level = parseLevel(overrides.level) ?? $options?.level;
  if (!level) {
    throw new CliError(`no level given: pass --level or set "$options".level in ${path}`);
  }
  const format = (overrides.format ?? $options?.format ?? 'pdf') as 'pdf' | 'xml';
  if (format !== 'pdf' && format !== 'xml') {
    throw new CliError(`unknown format "${format}" (expected pdf or xml)`);
  }
  const locale = overrides.locale ?? $options?.locale;

  const result = await create(invoice, { level, format, locale });
  for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);

  const out = explicitOut ?? `${basename(path, extname(path))}.${format}`;
  if (format === 'pdf') await writeFile(out, result.pdf!);
  else await writeFile(out, result.xml, 'utf-8');
  return out;
}

async function cmdCreate(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      level: { type: 'string' },
      format: { type: 'string' },
      locale: { type: 'string' },
      output: { type: 'string', short: 'o' },
    },
  });
  const input = positionals[0];
  if (!input) throw new CliError(`create needs an invoice JSON file\n\n${USAGE}`);
  const out = await createFromFile(input, values, values.output);
  process.stdout.write(`created ${out}\n`);
  return 0;
}

async function cmdVerify(argv: string[]): Promise<number> {
  const file = argv[0];
  if (!file) throw new CliError(`verify needs a PDF or XML file\n\n${USAGE}`);
  const bytes = new Uint8Array(await readFile(file));
  const result = await verify(bytes);
  if (result.valid) {
    process.stdout.write(
      `valid: ${file} is a Factur-X invoice, level "${result.level}" (${result.guidelineId}), ` +
        `read from ${result.source}\n`,
    );
    for (const warning of result.warnings) process.stdout.write(`warning: ${warning}\n`);
    return 0;
  }
  process.stderr.write(`invalid: ${file} is not a Factur-X invoice\n`);
  for (const error of result.errors) process.stderr.write(`  - ${error}\n`);
  return 1;
}

async function cmdExtract(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { output: { type: 'string', short: 'o' } },
  });
  const file = positionals[0];
  if (!file) throw new CliError(`extract needs a PDF file\n\n${USAGE}`);
  const { xml, filename } = await extract(new Uint8Array(await readFile(file)));
  if (values.output) {
    await writeFile(values.output, xml, 'utf-8');
    process.stdout.write(`extracted ${filename} to ${values.output}\n`);
  } else {
    process.stdout.write(xml);
  }
  return 0;
}

async function cmdBatch(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { 'out-dir': { type: 'string' } },
  });
  const dir = positionals[0];
  if (!dir) throw new CliError(`batch needs a directory of invoice JSON files\n\n${USAGE}`);
  const outDir = values['out-dir'] ?? '.';
  await mkdir(outDir, { recursive: true });
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new CliError(`no .json files found in ${dir}`);
  let failures = 0;
  for (const file of files) {
    const path = join(dir, file);
    try {
      const { $options } = await readInvoiceFile(path);
      const format = $options?.format ?? 'pdf';
      const out = join(outDir, `${basename(file, '.json')}.${format}`);
      await createFromFile(path, {}, out);
      process.stdout.write(`created ${out}\n`);
    } catch (cause) {
      failures += 1;
      process.stderr.write(
        `failed ${path}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
      );
    }
  }
  return failures === 0 ? 0 : 1;
}
