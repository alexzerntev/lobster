import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import type { LobsterWorkflowDetail } from "../workflow-types.js";
import { subworkflowTarget } from "./subworkflow-target.js";

function parent(value: string, filename = "folder/parent.lobster"): LobsterWorkflowDetail {
	return {
		id: "file:parent",
		name: "Parent",
		source: "file",
		definition: { filename, language: "yaml", text: "" },
		steps: [{ id: "child", fields: [{ name: "workflow", value }] }],
	};
}

describe("sub-workflow targets", () => {
	it.each([
		["child.lobster", "folder/child.lobster"],
		["./nested/../child.YAML", "folder/child.YAML"],
		["../other/child.json", "other/child.json"],
		["../δοκιμή/🦞 recipe.yml", "δοκιμή/🦞 recipe.yml"],
		["./literal%2F#file.yml", "folder/literal%2F#file.yml"],
	])(
		"resolves %s relative to the parent file with the server's UTF-8 ID encoding",
		(path, filename) => {
			expect(subworkflowTarget(parent(stringify(path)), "child")).toEqual({
				filename,
				id: `file:${Buffer.from(filename, "utf8").toString("base64url")}`,
			});
		},
	);

	it.each([
		["root escape", "../../child.lobster", /leaves workspace\/workflows/],
		["absolute path", "/other/child.lobster", /relative sub-workflow path/],
		["Windows path", "C:\\other\\child.yaml", /relative sub-workflow path/],
		["hidden path", ".private/child.yaml", /hidden folders/],
		["dependency path", "node_modules/child.yaml", /node_modules/],
		["step reference", "$prepare.stdout", /runtime values/],
		["argument reference", "${child}.lobster", /runtime values/],
		["redacted token", "secret…tail.lobster", /redacted/],
		["redacted field", "***.yaml", /redacted/],
		["unsupported source", "child.js", /\.lobster, \.yaml/],
		["control character", "child\u0000.yaml", /relative sub-workflow path/],
	])("rejects %s with an actionable reason", (_name, path, message) => {
		expect(() => subworkflowTarget(parent(stringify(path)), "child")).toThrow(message);
	});

	it.each(["[", "null", "123", "[]", '""', "&cycle [*cycle]"])(
		"rejects malformed or non-string metadata without resolving a filename",
		(value) => {
			expect(() => subworkflowTarget(parent(value), "child")).toThrow(/sub-workflow path/);
		},
	);

	it("keeps path byte and directory limits aligned with the source catalog", () => {
		const filename = `${"é".repeat(1021)}.yaml`;
		expect(subworkflowTarget(parent(stringify(filename), "parent.yaml"), "child").filename).toBe(
			filename,
		);
		expect(() =>
			subworkflowTarget(parent(stringify(`é${filename}`), "parent.yaml"), "child"),
		).toThrow(/2048 UTF-8 bytes/);
		const nested = `${"dir/".repeat(8)}child.lobster`;
		expect(subworkflowTarget(parent(nested, "parent.yaml"), "child").filename).toBe(nested);
		expect(() => subworkflowTarget(parent(`dir/${nested}`, "parent.yaml"), "child")).toThrow(
			/8 directory levels/,
		);
		expect(() => subworkflowTarget(parent("x".repeat(256 * 1024 + 1)), "child")).toThrow(/256 KiB/);
	});

	it("requires a source location and the selected node's workflow field", () => {
		const workflow = parent("child.yaml");
		expect(() => subworkflowTarget(workflow, "missing")).toThrow(/no sub-workflow path/);
		delete workflow.definition;
		expect(() => subworkflowTarget(workflow, "child")).toThrow(/source directory/);
		expect(() =>
			subworkflowTarget({ ...parent("child.yaml"), source: "builtin" }, "child"),
		).toThrow(/source directory/);
	});
});
