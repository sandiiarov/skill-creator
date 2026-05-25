import { describe, expect, it } from "vitest";

import { PETSTORE_SPEC_WITH_REFS } from "../test-fixtures/petstore.js";
import { resolveRefs } from "./refs.js";

describe("resolveRefs", () => {
	it("resolves local JSON pointer refs without mutating input", async () => {
		const resolved = await resolveRefs(PETSTORE_SPEC_WITH_REFS);
		expect(resolved.paths["/pets"].get.parameters[0]).toMatchObject({
			name: "limit",
			in: "query",
		});
		expect(PETSTORE_SPEC_WITH_REFS.paths["/pets"].get.parameters[0]).toEqual({
			$ref: "#/components/parameters/LimitParam",
		});
	});

	it("leaves circular refs safe instead of recursing forever", async () => {
		const resolved = await resolveRefs({
			a: { $ref: "#/b" },
			b: { $ref: "#/a" },
		});
		expect(JSON.stringify(resolved)).toContain("$ref");
	});

	it("resolves local refs that the parser leaves behind", async () => {
		const resolved = await resolveRefs({
			openapi: "3.1.0",
			paths: {
				"/search": {
					post: {
						requestBody: {
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/SearchRequest" },
								},
							},
						},
					},
				},
			},
			components: {
				schemas: {
					SearchRequest: {
						type: "object",
						required: ["query"],
						properties: { query: { type: "string" } },
					},
				},
			},
		});

		const schema = resolved.paths["/search"].post.requestBody.content[
			"application/json"
		].schema as unknown as { properties: { query: { type: string } } };
		expect(schema.properties.query).toEqual({ type: "string" });
	});
});
