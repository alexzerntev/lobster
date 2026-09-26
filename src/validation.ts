import { Ajv, type AnySchema, type Options, type ValidateFunction } from "ajv";

import { stableStringify } from "./state/store.js";

const maxCompilationAttempts = 128;

/**
 * Reuse equivalent schemas within a bounded compiler generation. Ajv retains
 * generated-code references even after removeSchema(), so rotating the compiler
 * also releases those references when callers no longer hold its validators.
 * Failed compilations count toward the limit because they can retain state too.
 */
export function createCompileCached(options: Options): (schema: AnySchema) => ValidateFunction {
	const cache = new Map<string, ValidateFunction>();
	let ajv = new Ajv(options);
	let attempts = 0;
	return function compileCached(schema: AnySchema): ValidateFunction {
		const key = stableStringify(schema);
		let validator = cache.get(key);
		if (!validator) {
			if (attempts === maxCompilationAttempts) {
				ajv = new Ajv(options);
				cache.clear();
				attempts = 0;
			}
			attempts += 1;
			validator = ajv.compile(schema);
			cache.set(key, validator);
		}
		return validator;
	};
}

export const compileCached = createCompileCached({
	allErrors: false,
	strict: false,
	// User-provided schemas may repeat `$id` across runs/resumes.
	addUsedSchema: false,
});
