import $RefParser from '@apidevtools/json-schema-ref-parser';

export async function resolveRefs<T>(input: T): Promise<T> {
  return (await $RefParser.dereference(input as object, {
    mutateInputSchema: false,
    dereference: { circular: 'ignore' },
  })) as T;
}
