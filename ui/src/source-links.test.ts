import { createElement as h, act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SourceLinksContext, SourceText } from "./source-links.js";

const files = [
	"flows/child.lobster",
	"flows/child$.lobster",
	"flows/release…2026.lobster",
	"config.json",
	"flows/config.json",
	"file.js",
	"scripts/a b.js",
].map((path) => ({ path, language: "plaintext" as const }));
function preview(text: string, field?: string) {
	const container = document.createElement("div");
	container.innerHTML = renderToStaticMarkup(
		h(
			SourceLinksContext.Provider,
			{ value: { files, filename: "flows/main.lobster", open() {} } },
			h(SourceText, { text, field }),
		),
	);
	return container;
}

describe("node file references", () => {
	it("preserves literal paths and ignores ambiguous, external, dynamic and partial filenames", () => {
		const text =
			'node "scripts/a b.js" --config=config.json other/file.js ${dir}/file.js /etc/file.js https://example.test/file.js file.jsx <img src=x>';
		const result = preview(text);
		expect(result.textContent).toBe(text);
		expect(
			Array.from(result.querySelectorAll("button"), (button) => button.dataset.sourcePath),
		).toEqual(["scripts/a b.js"]);
		expect(result.querySelector("img")).toBeNull();
	});

	it.each([
		"child.lobster ${args.suffix}",
		"child.lobster missing",
		"[child.lobster]",
		"'child.lobster' trailing",
	])("does not resolve part of the workflow scalar: %s", (text) => {
		expect(preview(text, "workflow").querySelector("button")).toBeNull();
	});

	it("resolves quoted and normalized workflow paths relative to the declaring file", () => {
		expect(
			preview('"../flows/./child.lobster"', "workflow").querySelector("button")?.dataset.sourcePath,
		).toBe("flows/child.lobster");
		expect(preview("../../child.lobster", "workflow").querySelector("button")).toBeNull();
	});

	it.each(["child$.lobster", "release…2026.lobster"])(
		"links a literal workflow filename without inferring runtime or redaction syntax: %s",
		(filename) => {
			expect(preview(filename, "workflow").querySelector("button")?.dataset.sourcePath).toBe(
				`flows/${filename}`,
			);
		},
	);

	it("bounds highlighted links while preserving the complete code and safe file names", async () => {
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		const container = document.createElement("div");
		const root = createRoot(container);
		const text = `printf '<img src=x>' ; node ${Array.from({ length: 200 }, () => '"file.js"').join(" ")}`;
		const open = vi.fn();
		try {
			await act(async () =>
				root.render(
					h(
						SourceLinksContext.Provider,
						{ value: { files, open } },
						h(SourceText, { text, language: "bash", code: true }),
					),
				),
			);
			expect(container.textContent).toBe(text);
			expect(container.querySelectorAll("button")).toHaveLength(100);
			expect(container.querySelector(".hljs-built_in")?.textContent).toBe("printf");
			expect(container.querySelector("img")).toBeNull();
			container.querySelector("button")!.click();
			expect(open).toHaveBeenCalledWith("file.js");
		} finally {
			await act(async () => root.unmount());
			vi.unstubAllGlobals();
		}
	});
});
