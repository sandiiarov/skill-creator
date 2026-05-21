import { readFile } from 'node:fs/promises';

export async function resolveSecret(value: string): Promise<string> {
  if (value.startsWith('env:')) {
    const name = value.slice(4);
    const resolved = process.env[name];
    if (resolved === undefined)
      throw new Error(`environment variable ${JSON.stringify(name)} is not set`);
    return resolved;
  }

  if (value.startsWith('file:')) {
    const path = value.slice(5);
    try {
      return (await readFile(path, 'utf8')).replace(/\n$/, '');
    } catch {
      throw new Error(`secret file not found: ${path}`);
    }
  }

  return value;
}
