import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import addFormatsPlugin from "ajv-formats";

import type { CliValueType, JsonSchema } from "./types.js";

const ajv = new Ajv({ allErrors: true, strict: false });
const addFormats = addFormatsPlugin as unknown as (instance: Ajv) => Ajv;
addFormats(ajv);
const validatorCache = new WeakMap<JsonSchema, ValidateFunction>();

export function schemaTypeToCliType(schema: JsonSchema): {
	type: CliValueType;
	suffix: string;
} {
	const effectiveSchema = unwrapNullableUnion(schema);
	switch (effectiveSchema.type) {
		case "integer":
			return { type: "integer", suffix: "" };
		case "number":
			return { type: "number", suffix: "" };
		case "boolean":
			return { type: "boolean", suffix: "" };
		case "array":
			return { type: "string", suffix: " (JSON array)" };
		case "object":
			return { type: "string", suffix: " (JSON object)" };
		default:
			return { type: "string", suffix: "" };
	}
}

export function coerceAndValidateValue(
	value: unknown,
	schema: JsonSchema = {},
	label = "value",
): unknown {
	const coerced = coerceValue(value, schema);
	validateValue(coerced, schema, label);
	return coerced;
}

export function validateValue(
	value: unknown,
	schema: JsonSchema = {},
	label = "value",
): void {
	if (Object.keys(schema).length === 0) return;

	const validate = validatorFor(schema);
	if (validate(value)) return;

	throw new Error(
		`${label} failed validation: ${formatAjvErrors(validate.errors ?? [], label)}`,
	);
}

function validatorFor(schema: JsonSchema): ValidateFunction {
	const cached = validatorCache.get(schema);
	if (cached !== undefined) return cached;

	const validate = ajv.compile(normalizeSchema(schema));
	validatorCache.set(schema, validate);
	return validate;
}

function normalizeSchema(schema: JsonSchema): object {
	if (schema.nullable === true && typeof schema.type === "string") {
		return { ...schema, type: [schema.type, "null"] };
	}
	return schema;
}

function formatAjvErrors(
	errors: readonly ErrorObject[],
	label: string,
): string {
	return errors
		.map((error) => {
			const path =
				error.instancePath.length > 0 ? `${label}${error.instancePath}` : label;
			return `${path} ${error.message ?? "is invalid"}`;
		})
		.join("; ");
}

export function coerceValue(value: unknown, schema: JsonSchema = {}): unknown {
	if (value === null || value === undefined) return null;

	const effectiveSchema = unwrapNullableUnion(schema);
	switch (effectiveSchema.type) {
		case "array":
			return coerceArray(value, effectiveSchema.items);
		case "object":
			return coerceObject(value);
		case "boolean":
			return Boolean(value);
		case "integer":
			return typeof value === "number"
				? Math.trunc(value)
				: Number.parseInt(String(value), 10);
		case "number":
			return typeof value === "number"
				? value
				: Number.parseFloat(String(value));
		default:
			return coerceSchemaless(value);
	}
}

function unwrapNullableUnion(schema: JsonSchema): JsonSchema {
	const variants = [
		...(Array.isArray(schema.anyOf) ? schema.anyOf : []),
		...(Array.isArray(schema.oneOf) ? schema.oneOf : []),
	].filter(
		(variant): variant is JsonSchema =>
			typeof variant === "object" &&
			variant !== null &&
			!Array.isArray(variant),
	);
	const nonNull = variants.find((variant) => variant.type !== "null");
	return nonNull ?? schema;
}

function coerceArray(
	value: unknown,
	itemSchema?: JsonSchema,
): unknown[] | unknown {
	if (Array.isArray(value)) return value;
	if (typeof value !== "string") return value;

	try {
		const parsed: unknown = JSON.parse(value);
		if (Array.isArray(parsed)) return parsed;
	} catch {
		// Fall back to comma/single value handling below.
	}

	const values = value.includes(",")
		? value.split(",").map((part) => part.trim())
		: [value];
	return values.map((item) => coerceItem(item, itemSchema?.type));
}

function coerceItem(value: string, type: string | undefined): unknown {
	switch (type) {
		case "integer":
			return Number.parseInt(value, 10);
		case "number":
			return Number.parseFloat(value);
		case "boolean":
			return ["true", "1", "yes"].includes(value.toLowerCase());
		default:
			return value;
	}
}

function coerceObject(value: unknown): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function coerceSchemaless(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	if (!trimmed || !["{", "["].includes(trimmed[0] ?? "")) return value;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		return typeof parsed === "object" && parsed !== null ? parsed : value;
	} catch {
		return value;
	}
}
