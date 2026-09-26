import test from "node:test";
import assert from "node:assert/strict";
import { Ajv } from "ajv";

import { compileCached, createCompileCached } from "../src/validation.js";

test("compileCached reuses validators for structurally equivalent schemas", (t) => {
	const compile = t.mock.method(Ajv.prototype, "compile");
	const compileCached = createCompileCached({ strict: false });
	const first = compileCached({
		type: "object",
		properties: { value: { type: "string" } },
		required: ["value"],
	});
	const second = compileCached({
		required: ["value"],
		properties: { value: { type: "string" } },
		type: "object",
	});

	assert.equal(second, first);
	assert.equal(compile.mock.callCount(), 1);
	assert.equal(first({ value: "ok" }), true);
});

test("compileCached rotates compilers for changing schemas while held validators remain valid", (t) => {
	const compile = t.mock.method(Ajv.prototype, "compile");
	const first = compileCached({ const: "retained-validator" });
	assert.equal(compileCached({ const: "retained-validator" }), first);
	for (let i = 0; i < 256; i += 1) {
		const validate = compileCached({ const: `changed-schema-${i}` });
		assert.equal(validate(`changed-schema-${i}`), true);
	}
	const callsByCompiler = new Map<unknown, number>();
	for (const { this: compiler } of compile.mock.calls) {
		callsByCompiler.set(compiler, (callsByCompiler.get(compiler) ?? 0) + 1);
	}
	assert.ok(callsByCompiler.size > 1, "A long-lived cache must release old Ajv generations");
	assert.ok([...callsByCompiler.values()].every((count) => count <= 128));
	assert.equal(first("retained-validator"), true);
	assert.equal(first("wrong"), false);
	assert.notEqual(compileCached({ const: "retained-validator" }), first);
});

test("compileCached bounds compiler generations after rejected schemas", (t) => {
	const compile = t.mock.method(Ajv.prototype, "compile");
	for (let i = 0; i < 256; i += 1) {
		assert.throws(() => compileCached({ type: `invalid-type-${i}` }));
	}
	const callsByCompiler = new Map<unknown, number>();
	for (const { this: compiler } of compile.mock.calls) {
		callsByCompiler.set(compiler, (callsByCompiler.get(compiler) ?? 0) + 1);
	}
	assert.ok(callsByCompiler.size > 1, "Rejected schemas must not bypass the compiler limit");
	assert.ok([...callsByCompiler.values()].every((count) => count <= 128));
	assert.equal(compileCached({ type: "string" })("recovered"), true);
});
