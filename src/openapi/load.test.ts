import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PETSTORE_SPEC } from '../test-fixtures/petstore.js';
import { loadOpenApiSpec } from './load.js';

describe('loadOpenApiSpec', () => {
  it('loads local JSON and YAML spec files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-creator-openapi-'));
    const jsonPath = join(dir, 'openapi.json');
    const yamlPath = join(dir, 'openapi.yaml');
    await writeFile(jsonPath, JSON.stringify(PETSTORE_SPEC));
    await writeFile(
      yamlPath,
      'openapi: 3.0.0\ninfo:\n  title: YAML\n  version: "1"\npaths:\n  /ping:\n    get:\n      operationId: ping\n',
    );

    await expect(loadOpenApiSpec(jsonPath)).resolves.toMatchObject({
      paths: { '/pets': expect.any(Object) },
    });
    await expect(loadOpenApiSpec(yamlPath)).resolves.toMatchObject({
      paths: { '/ping': expect.any(Object) },
    });
  });

  it('rejects documents without paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-creator-openapi-'));
    const path = join(dir, 'bad.json');
    await writeFile(path, JSON.stringify({ openapi: '3.0.0' }));
    await expect(loadOpenApiSpec(path)).rejects.toThrow(/must contain 'paths'/);
  });
});
