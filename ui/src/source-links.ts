import { createContext, createElement as h, useContext, type ReactNode } from "react";
import { parse as parseYaml } from "yaml";
import type { LobsterSourceFile } from "../workflow-types.js";
import { isDynamicWorkflowPath } from "./subworkflow-target.js";
import { syntax } from "./syntax.js";

type FileLinks = {
	files: readonly LobsterSourceFile[];
	filename?: string;
	open: (path: string) => void;
};
type Reference = { start: number; end: number; path: string };
export const SourceLinksContext = createContext<FileLinks | null>(null);

function isLiteralPath(value: string, field?: string): boolean {
	return (
		Boolean(value) &&
		!value.startsWith("/") &&
		!(field === "workflow" ? isDynamicWorkflowPath(value) : value.includes("$")) &&
		!/[`*?:\\]/u.test(value) &&
		!Array.from(value).some(
			(character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
		)
	);
}

function normalize(path: string, field?: string): string | undefined {
	if (!isLiteralPath(path, field)) {
		return undefined;
	}
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (!part || part === ".") {
			continue;
		}
		if (part === "..") {
			if (!parts.length) {
				return undefined;
			}
			parts.pop();
		} else {
			parts.push(part);
		}
	}
	return parts.join("/");
}

function fileReferences(text: string, context: FileLinks, field?: string): Reference[] {
	const known = new Set(context.files.map((file) => file.path));
	const directory = context.filename?.split("/").slice(0, -1).join("/");
	const resolve = (value: string) => {
		if (!isLiteralPath(value, field)) {
			return undefined;
		}
		const relative = normalize(directory ? `${directory}/${value}` : value, field);
		// Lobster resolves the workflow field relative to its declaring file.
		if (field === "workflow") {
			return relative && known.has(relative) ? relative : undefined;
		}
		const candidates = new Set(
			[
				normalize(value),
				relative,
				value.startsWith("workflows/") ? normalize(value.slice(10)) : undefined,
			].filter((path): path is string => path !== undefined && known.has(path)),
		);
		return candidates.size === 1 ? [...candidates][0] : undefined;
	};
	const whole = text.trim();
	if (field === "workflow") {
		try {
			const value: unknown = parseYaml(text, { maxAliasCount: 0 });
			const path = typeof value === "string" ? resolve(value) : undefined;
			const start = text.indexOf(whole);
			return path ? [{ start, end: start + whole.length, path }] : [];
		} catch {
			return [];
		}
	}
	const exact = resolve(whole);
	if (exact) {
		const start = text.indexOf(whole);
		return [{ start, end: start + whole.length, path: exact }];
	}
	const references: Reference[] = [];
	const tokens = /"[^"\n]*"|'[^'\n]*'|[^\s"'`=;|&<>()[\],]+/gu;
	const scan = (value: string, offset: number, quoted = false) => {
		for (const match of value.matchAll(tokens)) {
			// Link decoration must stay bounded even when a field repeats one filename thousands of times.
			if (references.length >= 100) {
				break;
			}
			const token = match[0];
			const isQuoted = token.startsWith('"') || token.startsWith("'");
			const content = isQuoted ? token.slice(1, -1) : token;
			const start = offset + match.index + (isQuoted ? 1 : 0);
			const path = resolve(content);
			if (path) {
				references.push({ start, end: start + content.length, path });
			} else if (isQuoted && !quoted && !/^(?:[\w+.-]+:|\/)/u.test(content)) {
				scan(content, start, true);
			}
		}
	};
	scan(text, 0);
	return references;
}

/** Link known sources without losing syntax spans or interpreting markup in file names. */
export function SourceText({
	text,
	language,
	field,
	code = false,
}: {
	text: string;
	language?: string;
	field?: string;
	code?: boolean;
}) {
	const context = useContext(SourceLinksContext);
	const references = context ? fileReferences(text, context, field) : [];
	if (!language) {
		const children: ReactNode[] = [];
		let offset = 0;
		for (const reference of references) {
			children.push(
				text.slice(offset, reference.start),
				h(
					"button",
					{
						key: reference.start,
						type: "button",
						className: "lobster-graph__file-link nodrag nopan",
						title: `Open ${reference.path} in Code`,
						"aria-label": `Open ${reference.path} in Code`,
						"data-source-path": reference.path,
						onClick: (event) => {
							event.stopPropagation();
							context?.open(reference.path);
						},
						onKeyDown: (event) => event.stopPropagation(),
					},
					text.slice(reference.start, reference.end),
				),
			);
			offset = reference.end;
		}
		children.push(text.slice(offset));
		return h(code ? "code" : "span", null, ...children);
	}
	return h(code ? "code" : "span", {
		className: language ? `language-${language}` : undefined,
		ref: (element: HTMLElement | null) => {
			if (!element) {
				return;
			}
			element.textContent = text;
			element.removeAttribute("data-highlighted");
			if (language) {
				syntax.highlightElement(element);
			}
			if (!context) {
				return;
			}
			for (const reference of references.toReversed()) {
				const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
				const range = document.createRange();
				let offset = 0;
				let started = false;
				let node: Node | null;
				while ((node = walker.nextNode())) {
					const length = node.textContent?.length ?? 0;
					if (!started && offset + length > reference.start) {
						range.setStart(node, reference.start - offset);
						started = true;
					}
					if (started && offset + length >= reference.end) {
						range.setEnd(node, reference.end - offset);
						break;
					}
					offset += length;
				}
				if (!started || !node) {
					continue;
				}
				const button = document.createElement("button");
				button.type = "button";
				button.className = "lobster-graph__file-link nodrag nopan";
				button.title = `Open ${reference.path} in Code`;
				button.setAttribute("aria-label", button.title);
				button.dataset.sourcePath = reference.path;
				button.append(range.extractContents());
				button.addEventListener("click", (event) => {
					event.stopPropagation();
					context.open(reference.path);
				});
				button.addEventListener("keydown", (event) => event.stopPropagation());
				range.insertNode(button);
			}
		},
	});
}
