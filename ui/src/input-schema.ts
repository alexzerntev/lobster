/** Presentation only: Lobster's Ajv validator remains the authority for responses. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function inputValue(value: unknown): string {
	return typeof value === "string" && value !== "" ? value : (JSON.stringify(value) ?? "");
}

export type InputField = {
	name: string;
	type: string;
	required: boolean;
	description?: string;
	control?: string;
	choices?: string[];
	notes: string[];
	groups: { label?: string; fields: InputField[] }[];
	details: [string, string][];
	raw?: string;
};

const mapKeywords = ["properties", "patternProperties", "definitions", "$defs", "dependencies"];
const singleKeywords = [
	"additionalProperties",
	"additionalItems",
	"contains",
	"propertyNames",
	"not",
	"if",
	"then",
	"else",
];
const arrayKeywords = ["allOf", "anyOf", "oneOf"];

function schemaChildren(schema: Record<string, unknown>): unknown[] {
	return [
		...mapKeywords.flatMap((key) => (isRecord(schema[key]) ? Object.values(schema[key]) : [])),
		...singleKeywords.map((key) => schema[key]),
		...arrayKeywords.flatMap((key) => (Array.isArray(schema[key]) ? schema[key] : [])),
		...(Array.isArray(schema.items) ? schema.items : [schema.items]),
	].filter((value) => isRecord(value) || typeof value === "boolean");
}

function absoluteRef(ref: string, base: string): string | undefined {
	try {
		return new URL(ref, base).href.replace(/#$/, "").replace(/%[\da-f]{2}/gi, (escape) => {
			const character = String.fromCharCode(Number.parseInt(escape.slice(1), 16));
			return /^[\w.~-]$/.test(character) ? character : escape.toUpperCase();
		});
	} catch {
		return undefined;
	}
}

/** Index only schema locations, never object-valued defaults, examples or enum choices. */
function references(root: unknown) {
	const initialBase = "https://lobster.invalid/response-schema";
	const resources = new Map<string, unknown>([[initialBase, root]]);
	const scopes = new Map<unknown, string>();
	const ambiguous = new Set<string>();
	let remaining = 4000;
	let truncated = false;
	const register = (id: string, value: unknown) => {
		if (resources.has(id) && resources.get(id) !== value) {
			ambiguous.add(id);
		}
		resources.set(id, value);
	};
	const visit = (schema: unknown, base: string, depth: number) => {
		if (!isRecord(schema) || scopes.has(schema)) {
			return;
		}
		if (depth > 60 || --remaining < 0) {
			truncated = true;
			return;
		}
		const id = typeof schema.$id === "string" ? absoluteRef(schema.$id, base) : undefined;
		const scope = id ?? base;
		scopes.set(schema, scope);
		if (id) {
			register(id, schema);
		}
		if (typeof schema.$anchor === "string") {
			const anchor = absoluteRef(`#${schema.$anchor}`, scope);
			if (anchor) {
				register(anchor, schema);
			}
		}
		for (const child of schemaChildren(schema)) {
			visit(child, scope, depth + 1);
		}
	};
	visit(root, initialBase, 0);
	return (ref: string, from: unknown): { value?: unknown; error?: string } => {
		if (truncated) {
			return { error: `Reference index limit reached. Inspect ${ref} in Code.` };
		}
		const address = absoluteRef(ref, scopes.get(from) ?? initialBase);
		if (!address) {
			return { error: `Invalid reference: ${ref}` };
		}
		const [resource = "", fragment = ""] = address.split("#");
		if (ambiguous.has(address) || ambiguous.has(resource)) {
			return { error: `Ambiguous schema reference: ${ref}` };
		}
		if (resources.has(address)) {
			return { value: resources.get(address) };
		}
		if (!resources.has(resource)) {
			return { error: `Reference unavailable in this schema: ${ref}` };
		}
		try {
			const pointer = decodeURIComponent(fragment);
			if (!pointer.startsWith("/")) {
				return { error: `Reference unavailable in this schema: ${ref}` };
			}
			let value: unknown = resources.get(resource);
			for (const part of pointer.slice(1).split("/")) {
				if (/~(?:[^01]|$)/.test(part)) {
					throw new Error("Invalid pointer");
				}
				const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
				if (!(isRecord(value) || Array.isArray(value)) || !Object.hasOwn(value, key)) {
					return { error: `Reference unavailable in this schema: ${ref}` };
				}
				value = Reflect.get(value, key);
			}
			return { value };
		} catch {
			return { error: `Invalid reference: ${ref}` };
		}
	};
}

const placeholders = new Map([
	["string", "Text"],
	["number", "Number"],
	["integer", "Whole number"],
	["boolean", "True / false"],
	["null", "null"],
	["array", "List of any values"],
	["object", "Object fields"],
	["any", "Any JSON value"],
]);

export function describeInputSchema(root: unknown): InputField {
	const resolve = references(root);
	let remaining = 400;
	const describe = (
		name: string,
		value: unknown,
		required: boolean,
		ancestors: Set<unknown>,
	): InputField => {
		const field: InputField = { name, type: "any", required, notes: [], groups: [], details: [] };
		if (--remaining < 0 || ancestors.size >= 12) {
			field.notes.push("Preview expansion limit reached. Inspect the remaining schema below.");
			field.raw = JSON.stringify(value, null, 2);
			return field;
		}
		if (ancestors.has(value)) {
			field.type = "recursive";
			field.notes.push("Recursive schema — repeats the enclosing fields.");
			return field;
		}
		if (typeof value === "boolean") {
			field.type = value ? "any" : "never";
			field.control = value ? "Any JSON value" : "No value is allowed";
			return field;
		}
		if (!isRecord(value)) {
			field.notes.push("Invalid schema. Inspect its definition below.");
			field.raw = JSON.stringify(value, null, 2);
			return field;
		}
		const schema = value;
		const path = new Set([...ancestors, schema]);
		const consumed = new Set<string>();
		const take = (key: string) => {
			consumed.add(key);
			return schema[key];
		};
		const note = (key: string, label: string) => {
			if (Object.hasOwn(schema, key)) {
				field.notes.push(`${label}: ${inputValue(take(key))}`);
			}
		};
		const remainder = (message: string) => {
			if (field.raw === undefined) {
				field.notes.push(message);
				field.raw = JSON.stringify(schema, null, 2);
			}
		};
		const group = (label: string | undefined, entries: [string, unknown, boolean][]) => {
			const fields: InputField[] = [];
			for (const [key, child, mandatory] of entries.slice(0, 100)) {
				if (remaining <= 0) {
					break;
				}
				fields.push(describe(key, child, mandatory, path));
			}
			if (fields.length || !entries.length) {
				field.groups.push({ label, fields });
			}
			if (entries.length > fields.length) {
				remainder(
					`${entries.length - fields.length} more fields are available in the schema below.`,
				);
			}
		};
		const type = take("type");
		const types =
			typeof type === "string"
				? [type]
				: Array.isArray(type) && type.every((t) => typeof t === "string")
					? [...type]
					: [];
		if (schema.nullable === true && types.length && !types.includes("null")) {
			types.push("null");
		}
		field.type =
			types.join(" | ") ||
			(Array.isArray(schema.enum)
				? "enum"
				: ["$ref", "oneOf", "anyOf", "allOf"].some((key) => Object.hasOwn(schema, key))
					? "schema"
					: "any");
		if (typeof schema.description === "string") {
			field.description = String(take("description"));
		}
		note("title", "Title");
		note("default", "Suggested default");
		note("examples", "Examples");
		if (Object.hasOwn(schema, "const")) {
			field.control = `Fixed value: ${JSON.stringify(take("const"))}`;
		}
		if (Array.isArray(schema.enum)) {
			const options = schema.enum;
			take("enum");
			// Quote strings in mixed enums to distinguish, for example, "false" from false.
			const mixed = options.some((option) => typeof option !== "string");
			field.choices = options.map((option) =>
				mixed ? (JSON.stringify(option) ?? "") : inputValue(option),
			);
			if (!options.length) {
				field.notes.push("No enum choices are allowed.");
			}
		}
		if (typeof schema.$ref === "string") {
			take("$ref");
			const resolved = resolve(schema.$ref, schema);
			if (resolved.error) {
				field.notes.push(resolved.error);
			} else {
				group(`Reference · ${schema.$ref}`, [[name, resolved.value, required]]);
			}
		}
		const properties = isRecord(schema.properties) ? schema.properties : {};
		if (isRecord(schema.properties)) {
			take("properties");
		}
		const requiredNames = Array.isArray(schema.required)
			? schema.required.filter((key): key is string => typeof key === "string")
			: [];
		if (Array.isArray(schema.required)) {
			take("required");
		}
		const objectShape =
			types.includes("object") ||
			[
				"properties",
				"patternProperties",
				"additionalProperties",
				"required",
				"dependencies",
				"propertyNames",
			].some((key) => Object.hasOwn(schema, key));
		if (objectShape) {
			if (!types.includes("object")) {
				field.notes.push("These fields apply when the value is an object.");
			}
			const entries: [string, unknown, boolean][] = Object.entries(properties).map(
				([key, child]) => [key || '"" (empty name)', child, requiredNames.includes(key)],
			);
			for (const key of requiredNames) {
				if (!Object.hasOwn(properties, key)) {
					entries.push([key || '"" (empty name)', true, true]);
				}
			}
			if (entries.length) {
				group(types.length > 1 ? "Object fields" : undefined, entries);
			}
			if (isRecord(schema.patternProperties)) {
				take("patternProperties");
				group(
					"Fields matching a name pattern",
					Object.entries(schema.patternProperties).map(([key, child]) => [key, child, false]),
				);
			}
			if (isRecord(schema.additionalProperties)) {
				take("additionalProperties");
				group("Additional fields", [["Any other name", schema.additionalProperties, false]]);
			} else if (schema.additionalProperties === false) {
				take("additionalProperties");
				field.notes.push("No additional fields.");
			} else if (
				schema.additionalProperties === true ||
				!Object.hasOwn(schema, "additionalProperties")
			) {
				take("additionalProperties");
				field.notes.push("Additional fields accept any JSON value.");
			}
			if (Object.hasOwn(schema, "propertyNames")) {
				take("propertyNames");
				group("Rules for every field name", [["Field name", schema.propertyNames, false]]);
			}
			if (isRecord(schema.dependencies)) {
				take("dependencies");
				for (const [key, child] of Object.entries(schema.dependencies)) {
					if (remaining <= 0) {
						remainder("More dependencies are available in the schema below.");
						break;
					}
					if (Array.isArray(child)) {
						remaining -= 1;
						field.notes.push(
							`When ${key} is present, also require: ${child.map(inputValue).join(", ")}`,
						);
					} else {
						group(`When ${key} is present`, [["Whole object", child, false]]);
					}
				}
			}
		}
		if (
			types.includes("array") ||
			Object.hasOwn(schema, "items") ||
			Object.hasOwn(schema, "contains")
		) {
			if (!types.includes("array")) {
				field.notes.push("Item rules apply when the value is an array.");
			}
			if (Array.isArray(schema.items)) {
				take("items");
				group(
					"Items by position",
					schema.items.map((child, index) => [
						`Item ${index + 1}`,
						child,
						typeof schema.minItems === "number" && index < schema.minItems,
					]),
				);
				if (schema.additionalItems === false) {
					take("additionalItems");
					field.notes.push("No additional items.");
				} else {
					take("additionalItems");
					group("Remaining items", [
						[
							"Item",
							Object.hasOwn(schema, "additionalItems") ? schema.additionalItems : true,
							false,
						],
					]);
				}
			} else {
				take("items");
				group("List item template", [
					["Each item", Object.hasOwn(schema, "items") ? schema.items : true, false],
				]);
			}
			if (Object.hasOwn(schema, "contains")) {
				take("contains");
				group("At least one item must match", [["Matching item", schema.contains, true]]);
			}
		}
		for (const [keyword, label] of [
			["allOf", "All requirements apply"],
			["oneOf", "Exactly one alternative must match"],
			["anyOf", "At least one alternative must match"],
		] as const) {
			const alternatives = schema[keyword];
			if (Array.isArray(alternatives)) {
				take(keyword);
				group(
					label,
					alternatives.map((child, index) => [
						isRecord(child) && typeof child.title === "string"
							? child.title
							: `Option ${index + 1}`,
						child,
						false,
					]),
				);
			}
		}
		if (Object.hasOwn(schema, "if")) {
			take("if");
			group("Condition", [["If this matches", schema.if, false]]);
			if (Object.hasOwn(schema, "then")) {
				take("then");
				group("When condition matches", [["Then", schema.then, false]]);
			}
			if (Object.hasOwn(schema, "else")) {
				take("else");
				group("Otherwise", [["Else", schema.else, false]]);
			}
		}
		if (Object.hasOwn(schema, "not")) {
			take("not");
			group("Must not match", [["Excluded shape", schema.not, false]]);
		}
		// Keep constraints and unfamiliar keywords inspectable instead of silently weakening the schema.
		for (const [key, entry] of Object.entries(schema)) {
			if (!consumed.has(key) && !["definitions", "$defs"].includes(key)) {
				if (remaining <= 0) {
					remainder("More constraints are available in the schema below.");
					break;
				}
				remaining -= 1;
				field.details.push([key, inputValue(entry)]);
			}
		}
		if (!field.control && !field.choices && !field.groups.length && !schema.$ref) {
			field.control =
				placeholders.get(field.type) ??
				(types.length > 1 ? `Value of type ${field.type}` : "Value");
		}
		return field;
	};
	return describe("Response", root, true, new Set());
}
