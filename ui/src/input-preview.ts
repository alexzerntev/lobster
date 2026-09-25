import { createElement as h, useMemo, useState, type ReactElement } from "react";
import { parse as parseYaml } from "yaml";
import { describeInputSchema, inputValue, isRecord, type InputField } from "./input-schema.js";
import { SourceText } from "./source-links.js";

function Choices({ name, options }: { name: string; options: string[] }) {
	const [visible, setVisible] = useState(50);
	return h(
		"div",
		{ className: "lobster-input__select" },
		h(
			"div",
			{ className: "lobster-input__control" },
			"Select an option",
			h(
				"svg",
				{
					viewBox: "0 0 24 24",
					width: 16,
					height: 16,
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.5,
					"aria-hidden": true,
				},
				h("path", { d: "m6 15 6-6 6 6" }),
			),
		),
		h(
			"ul",
			{ className: "lobster-input__options", "aria-label": `${name} options` },
			...options
				.slice(0, visible)
				.map((option, index) =>
					h(
						"li",
						{ key: index },
						h("span", { className: "lobster-input__option-mark", "aria-hidden": true }),
						h(SourceText, { text: option }),
					),
				),
		),
		options.length > visible &&
			h(
				"button",
				{
					type: "button",
					className: "btn btn--sm lobster-input__more nodrag",
					onClick: () => setVisible((count) => count + 50),
				},
				`Show more (${options.length - visible} remaining)`,
			),
	);
}

function RemainingSchema({ raw }: { raw: string }) {
	const [open, setOpen] = useState(false);
	return h(
		"details",
		{
			className: "lobster-input__remaining nodrag",
			onToggle: (event) => setOpen(event.currentTarget.hasAttribute("open")),
		},
		h("summary", null, "Inspect schema"),
		open &&
			h(
				"pre",
				{ className: "lobster-input__raw nowheel" },
				h(SourceText, { text: raw, code: true }),
			),
	);
}

function Field({ field, root = false }: { field: InputField; root?: boolean }): ReactElement {
	return h(
		"div",
		{ className: "lobster-input__field", role: "group", "aria-label": field.name },
		!(root && field.type === "object") &&
			h(
				"div",
				{ className: "lobster-input__label" },
				h(
					"span",
					null,
					field.name,
					field.required &&
						h(
							"span",
							{ className: "lobster-input__required", title: "Required", "aria-label": "required" },
							" *",
						),
				),
				h("span", { className: "lobster-input__type" }, field.type),
			),
		field.description &&
			h(
				"p",
				{ className: "lobster-input__description" },
				h(SourceText, { text: field.description }),
			),
		field.control &&
			h("div", { className: "lobster-input__control" }, h(SourceText, { text: field.control })),
		field.choices && h(Choices, { name: field.name, options: field.choices }),
		...field.groups.map((group, index) =>
			h(
				"div",
				{
					className: root && !group.label ? "lobster-input__fields" : "lobster-input__group",
					key: `group-${index}`,
				},
				group.label && h("p", { className: "lobster-input__group-label" }, group.label),
				...group.fields.map((child, childIndex) => h(Field, { key: childIndex, field: child })),
			),
		),
		...field.notes.map((note, index) =>
			h(
				"p",
				{ className: "lobster-input__description", key: `note-${index}` },
				h(SourceText, { text: note }),
			),
		),
		field.details.length > 0 &&
			h(
				"dl",
				{ className: "lobster-input__constraints" },
				...field.details.map(([key, value]) =>
					h("div", { key }, h("dt", null, key), h("dd", null, h(SourceText, { text: value }))),
				),
			),
		field.raw !== undefined && h(RemainingSchema, { raw: field.raw }),
	);
}

/** A schema preview, never a live input request, validator, or response editor. */
export function WorkflowInputPreview({ definition }: { definition: string }) {
	const preview = useMemo(() => {
		try {
			const input: unknown = parseYaml(definition, { maxAliasCount: 0 });
			if (
				!isRecord(input) ||
				!(isRecord(input.responseSchema) || typeof input.responseSchema === "boolean")
			) {
				return undefined;
			}
			return { input, field: describeInputSchema(input.responseSchema) };
		} catch {
			return undefined;
		}
	}, [definition]);
	if (!preview) {
		return h(
			"pre",
			{ className: "lobster-input__raw" },
			h(SourceText, { text: definition, code: true }),
		);
	}
	return h(
		"div",
		{
			className: "lobster-input nodrag nowheel",
			role: "group",
			"aria-label": "Input form preview",
		},
		typeof preview.input.prompt === "string" &&
			h("p", { className: "lobster-input__prompt" }, h(SourceText, { text: preview.input.prompt })),
		h(Field, { field: preview.field, root: true, key: definition }),
		Object.hasOwn(preview.input, "defaults") &&
			h(
				"p",
				{ className: "lobster-input__description" },
				"Suggested response: ",
				h(SourceText, { text: inputValue(preview.input.defaults) }),
			),
		h("p", { className: "lobster-input__hint" }, "Read-only preview"),
	);
}
