import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkflowInputPreview } from "./input-preview.js";

function preview(definition: string) {
	const container = document.createElement("div");
	container.innerHTML = renderToStaticMarkup(createElement(WorkflowInputPreview, { definition }));
	return container;
}

describe("input form preview", () => {
	it("keeps unknown field types readable without crashing the node renderer", () => {
		const container = preview("responseSchema:\n  type: constructor");
		expect(container.querySelector(".lobster-input__type")?.textContent).toBe("constructor");
		expect(container.querySelector(".lobster-input__control")?.textContent).toBe("Value");
	});

	it.each([
		"input: [",
		"prompt: hello",
		"responseSchema: &schema\n  properties:\n    recursive: *schema",
	])(
		"keeps unreadable input definitions available without breaking the graph: %s",
		(definition) => {
			expect(preview(definition).querySelector("pre")?.textContent).toBe(definition);
		},
	);

	it("handles scalar responses, non-string choices and defaults without inventing a selection", () => {
		const container = preview(
			JSON.stringify({
				prompt: "Choose a value",
				defaults: false,
				responseSchema: { type: ["boolean", "null"], enum: [true, false, null] },
			}),
		);
		expect(container.textContent).toContain("boolean | null");
		expect(Array.from(container.querySelectorAll("li"), (option) => option.textContent)).toEqual([
			"true",
			"false",
			"null",
		]);
		expect(container.textContent).toContain("Suggested response: false");
		expect(container.querySelector("[aria-selected], input, select")).toBeNull();
	});

	it("keeps shared fields alongside alternatives instead of choosing or merging a branch", () => {
		const container = preview(
			JSON.stringify({
				responseSchema: {
					type: "object",
					properties: { hidden: { enum: ["misleading"] } },
					oneOf: [{ required: ["hidden"] }, { required: ["other"] }],
					allOf: [{ maxProperties: 3 }],
					anyOf: [{ minProperties: 1 }, { const: {} }],
				},
			}),
		);
		expect(container.textContent).toContain("Exactly one alternative must match");
		expect(container.textContent).toContain("All requirements apply");
		expect(container.textContent).toContain("At least one alternative must match");
		expect(container.textContent).toContain("misleading");
		expect(container.querySelector('[aria-label="other"] [aria-label="required"]')).not.toBeNull();
		expect(container.querySelector("[aria-selected], input, select")).toBeNull();
	});

	it("renders nested objects, lists and draft-07 tuples with their constraints", () => {
		const container = preview(
			JSON.stringify({
				responseSchema: {
					type: "object",
					properties: {
						account: {
							type: "object",
							properties: { name: { type: "string", minLength: 1, default: "" } },
							required: ["name"],
							additionalProperties: false,
						},
						tags: {
							type: "array",
							items: { type: "string" },
							minItems: 1,
							uniqueItems: true,
							contains: { const: "required-tag" },
						},
						pair: {
							type: "array",
							items: [
								{ type: "integer", minimum: 0 },
								{ type: "boolean", default: false },
							],
							minItems: 1,
							additionalItems: false,
						},
					},
					required: ["account"],
					additionalProperties: { type: "number" },
				},
			}),
		);
		expect(
			container.querySelector('[aria-label="account"] [aria-label="name"]')?.textContent,
		).toContain("stringText");
		expect(container.querySelector('[aria-label="name"] [aria-label="required"]')).not.toBeNull();
		expect(container.querySelector('[aria-label="Each item"]')?.textContent).toContain(
			"stringText",
		);
		expect(container.querySelector('[aria-label="Item 1"] [aria-label="required"]')).not.toBeNull();
		expect(container.querySelector('[aria-label="Item 2"] [aria-label="required"]')).toBeNull();
		expect(container.textContent).toContain("Suggested default: false");
		expect(container.textContent).toContain('Suggested default: ""');
		expect(container.textContent).toContain("No additional items.");
		expect(container.textContent).toContain("At least one item must match");
		expect(container.textContent).toContain("uniqueItemstrue");
		expect(container.textContent).toContain("Any other namenumberNumber");
	});

	it("resolves scoped resources and escaped pointers while keeping reference siblings", () => {
		const container = preview(
			JSON.stringify({
				responseSchema: {
					$id: "https://example.invalid/form.json",
					type: "object",
					definitions: {
						"a/b~c": { type: "integer", minimum: 0 },
						address: {
							$id: "address.json",
							type: "object",
							definitions: { local: { type: "string" } },
							properties: { street: { $ref: "#/definitions/local" } },
						},
						named: { $anchor: "named", type: "boolean" },
					},
					properties: {
						count: { $ref: "#/definitions/a~1b~0c", maximum: 5 },
						first: { $ref: "address.json" },
						second: { $ref: "address.json" },
						flag: { $ref: "#named" },
						encodedFlag: { $ref: "#%6Eamed" },
						encodedResource: { $ref: "%61ddress.json" },
					},
				},
			}),
		);
		expect(container.querySelector('[aria-label="count"]')?.textContent).toContain("minimum0");
		expect(container.querySelector('[aria-label="count"]')?.textContent).toContain("maximum5");
		expect(
			container.querySelectorAll('[aria-label="street"] .lobster-input__control'),
		).toHaveLength(3);
		expect(container.querySelector('[aria-label="flag"]')?.textContent).toContain("True / false");
		expect(container.querySelector('[aria-label="encodedFlag"]')?.textContent).toContain(
			"True / false",
		);
		expect(container.textContent).not.toContain("unavailable");
	});

	it("bounds recursion and distinguishes unresolved, duplicate and invalid references", () => {
		const container = preview(
			JSON.stringify({
				responseSchema: {
					type: "object",
					definitions: {
						a: { $id: "duplicate.json", type: "string" },
						b: { $id: "duplicate.json", type: "number" },
					},
					properties: {
						child: { $ref: "#" },
						remote: { $ref: "https://example.invalid/external" },
						ambiguous: { $ref: "duplicate.json" },
						invalid: { $ref: "#/%ZZ" },
						prototype: { $ref: "#/constructor" },
					},
				},
			}),
		);
		expect(container.textContent).toContain("Recursive schema");
		expect(container.textContent).toContain(
			"Reference unavailable in this schema: https://example.invalid/external",
		);
		expect(container.textContent).toContain("Ambiguous schema reference: duplicate.json");
		expect(container.textContent).toContain("Invalid reference: #/%ZZ");
		expect(container.textContent).toContain("Reference unavailable in this schema: #/constructor");
		expect(container.querySelectorAll(".lobster-input__field").length).toBeLessThan(20);
	});

	it("preserves conditionals, dependencies, name patterns and unfamiliar constraints", () => {
		const container = preview(
			JSON.stringify({
				responseSchema: {
					type: "object",
					properties: { kind: { enum: ["personal", "company"] } },
					patternProperties: { "^x-": { type: "string" } },
					propertyNames: { maxLength: 20 },
					dependencies: { company: ["taxId"], address: { required: ["postcode"] } },
					if: { properties: { kind: { const: "company" } } },
					// JSON Schema's `then` is data, not a Promise callback.
					// oxlint-disable-next-line unicorn/no-thenable
					then: { required: ["taxId"] },
					else: { required: ["name"] },
					not: { required: ["secret"] },
					"x-future-keyword": { policy: "visible" },
				},
			}),
		);
		for (const text of [
			"When company is present, also require: taxId",
			"When address is present",
			"If this matches",
			"When condition matches",
			"Otherwise",
			"Must not match",
			"Rules for every field name",
			"^x-",
			"x-future-keyword",
			'"policy":"visible"',
		]) {
			expect(container.textContent).toContain(text);
		}
		expect(
			container.querySelector('[aria-label="If this matches"] [aria-label="required"]'),
		).toBeNull();
	});

	it("keeps true, false, null and empty strings distinct, including boolean schemas", () => {
		const container = preview(
			JSON.stringify({
				defaults: null,
				responseSchema: {
					type: "object",
					properties: {
						mixed: { enum: [false, "false", 0, "0", null, "", {}, [1]] },
						nullable: { type: "string", nullable: true },
						anything: true,
						nothing: false,
						invalid: null,
					},
				},
			}),
		);
		expect(Array.from(container.querySelectorAll("li"), (option) => option.textContent)).toEqual([
			"false",
			'"false"',
			"0",
			'"0"',
			"null",
			'""',
			"{}",
			"[1]",
		]);
		expect(container.textContent).toContain("string | null");
		expect(container.textContent).toContain("Any JSON value");
		expect(container.textContent).toContain("No value is allowed");
		expect(container.textContent).toContain("Invalid schema");
		expect(container.textContent).toContain("Suggested response: null");
		expect(preview('{"responseSchema":false}').textContent).toContain("No value is allowed");
	});

	it("keeps large and deep schemas inspectable while bounding node expansion", () => {
		const nested = (depth: number): unknown =>
			depth ? { properties: { child: nested(depth - 1) } } : { type: "string" };
		const container = preview(
			JSON.stringify({
				responseSchema: {
					type: "object",
					properties: {
						deep: nested(30),
						wide: {
							properties: Object.fromEntries(
								Array.from({ length: 120 }, (_, i) => [`field${i}`, true]),
							),
						},
					},
				},
			}),
		);
		expect(container.textContent).toContain("Preview expansion limit reached");
		expect(container.textContent).toContain("20 more fields");
		expect(container.querySelectorAll("summary")).toHaveLength(2);
		expect(container.querySelectorAll(".lobster-input__field").length).toBeLessThan(120);
	});

	it("reveals further enum choices and resets the preview when its definition changes", async () => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		const container = document.createElement("div");
		const root = createRoot(container);
		try {
			const definition = JSON.stringify({
				responseSchema: { enum: Array.from({ length: 55 }, (_, i) => `choice-${i}`) },
			});
			await act(async () => root.render(createElement(WorkflowInputPreview, { definition })));
			expect(container.querySelectorAll("li")).toHaveLength(50);
			await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
			expect(container.querySelectorAll("li")).toHaveLength(55);
			await act(async () =>
				root.render(
					createElement(WorkflowInputPreview, {
						definition: definition.replace("choice-0", "updated"),
					}),
				),
			);
			expect(container.querySelectorAll("li")).toHaveLength(50);
			expect(container.querySelector("li")?.textContent).toBe("updated");
		} finally {
			await act(async () => root.unmount());
			vi.unstubAllGlobals();
		}
	});

	it("bounds large dependency sets without emitting an empty group for every remaining rule", () => {
		const dependencies = Object.fromEntries(
			Array.from({ length: 2000 }, (_, index) => [
				`key${index}`,
				index % 2 ? ["required"] : { properties: { value: { type: "string" } } },
			]),
		);
		const container = preview(JSON.stringify({ responseSchema: { type: "object", dependencies } }));
		expect(container.textContent).toContain("More dependencies are available");
		expect(
			container.querySelectorAll(".lobster-input__group, .lobster-input__description").length,
		).toBeLessThan(800);
		expect(container.querySelectorAll("summary")).toHaveLength(1);
	});
});
