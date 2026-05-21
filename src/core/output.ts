export type OutputOptions = {
  pretty?: boolean;
  raw?: boolean;
  head?: number;
  toon?: boolean;
};

export type FormattedOutput = {
  stdout: string;
  stderr: string;
};

export function applyHead<T>(data: T, n: number): T {
  if (Array.isArray(data)) return data.slice(0, n) as T;
  return data;
}

export function formatOutput(data: unknown, options: OutputOptions = {}): FormattedOutput {
  if (options.raw) {
    return {
      stdout: `${typeof data === 'string' ? data : JSON.stringify(data)}\n`,
      stderr: '',
    };
  }

  let value = parseJsonStringIfPossible(data);
  if (options.head !== undefined) value = applyHead(value, options.head);

  if (typeof value === 'string') {
    return { stdout: `${value}\n`, stderr: '' };
  }

  return {
    stdout: `${JSON.stringify(value, null, options.pretty ? 2 : 0)}\n`,
    stderr: '',
  };
}

function parseJsonStringIfPossible(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}
