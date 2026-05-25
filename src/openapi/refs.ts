import $RefParser from "@apidevtools/json-schema-ref-parser";

export async function resolveRefs<T>(input: T): Promise<T> {
	const parserResolved = (await $RefParser.dereference(input as object, {
		mutateInputSchema: false,
		dereference: { circular: "ignore" },
	})) as T;

	return resolveLocalRefs(parserResolved) as T;
}

function resolveLocalRefs(
	value: unknown,
	root = value,
	seen = new Set<string>(),
): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => resolveLocalRefs(item, root, seen));
	}
	if (!isObject(value)) return value;

	const ref = typeof value.$ref === "string" ? value.$ref : undefined;
	if (ref?.startsWith("#/")) {
		if (seen.has(ref)) return value;
		const target = getJsonPointer(root, ref.slice(1));
		if (target !== undefined) {
			const siblings = Object.fromEntries(
				Object.entries(value).filter(([key]) => key !== "$ref"),
			);
			const resolved = resolveLocalRefs(target, root, new Set([...seen, ref]));
			return Object.keys(siblings).length === 0
				? resolved
				: { ...(isObject(resolved) ? resolved : {}), ...siblings };
		}
	}

	return Object.fromEntries(
		Object.entries(value).map(([key, child]) => [
			key,
			resolveLocalRefs(child, root, seen),
		]),
	);
}

function getJsonPointer(root: unknown, pointer: string): unknown {
	const parts = pointer
		.split("/")
		.filter(Boolean)
		.map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
	let current = root;
	for (const part of parts) {
		if (!isObject(current) && !Array.isArray(current)) return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
