import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { create, verify } from '../src/index.js';
import type { CreateOptions, Invoice } from '../src/types.js';

const EXAMPLES_DIR = join(import.meta.dirname, '..', 'examples');

interface ExampleFile extends Invoice {
  $options?: Partial<CreateOptions>;
}

describe('example invoices', async () => {
  const files = (await readdir(EXAMPLES_DIR)).filter((f) => f.endsWith('.json')).sort();

  it('found the example set', () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  for (const file of files) {
    it(`${file} creates and verifies at its declared level`, async () => {
      const { $options, ...invoice } = JSON.parse(
        await readFile(join(EXAMPLES_DIR, file), 'utf-8'),
      ) as ExampleFile;
      expect($options?.level, `${file} must declare $options.level`).toBeDefined();

      const result = await create(invoice, {
        level: $options!.level!,
        format: $options?.format ?? 'pdf',
        locale: $options?.locale,
      });
      expect(result.warnings).toEqual([]);

      const verified = await verify(result.pdf ?? result.xml);
      expect(verified).toMatchObject({ valid: true, level: $options!.level });
    });
  }
});
