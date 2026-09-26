import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../src/cli.js";

test("view help is discoverable through the CLI and both command help forms", async (t) => {
	let stdout = "";
	t.mock.method(process.stdout, "write", (chunk) => {
		stdout += chunk;
		return true;
	});
	const stderr = t.mock.method(process.stderr, "write", () => true);
	const originalExitCode = process.exitCode;
	const originalSignalListeners = process.listenerCount("SIGINT");
	try {
		for (const args of [["--help"], ["view", "--help"], ["view", "-h"], ["help", "view"]]) {
			stdout = "";
			await runCli(args);
			assert.match(stdout, /lobster view \[--workspace <directory>\] \[--port <port>\]/);
			if (args[0] !== "--help") {
				assert.match(stdout, /127\.0\.0\.1/);
				assert.match(stdout, /default: 5180/);
			}
			assert.equal(process.exitCode, originalExitCode);
			assert.equal(process.listenerCount("SIGINT"), originalSignalListeners);
		}
		assert.equal(stderr.mock.callCount(), 0);
	} finally {
		process.exitCode = originalExitCode;
	}
});

test("view rejects malformed options before starting a server", async (t) => {
	let stderr = "";
	t.mock.method(process.stderr, "write", (chunk) => {
		stderr += chunk;
		return true;
	});
	const stdout = t.mock.method(process.stdout, "write", () => true);
	const originalExitCode = process.exitCode;
	const originalSignalListeners = process.listenerCount("SIGINT");
	try {
		for (const args of [
			["--port"],
			["--port=-1"],
			["--port=65536"],
			["--port=1.5"],
			["--port=abc"],
			["--port="],
			["--workspace"],
			["--workspace="],
			["--host=0.0.0.0"],
			["unexpected.lobster"],
		]) {
			stderr = "";
			process.exitCode = undefined;
			await runCli(["view", ...args]);
			assert.equal(process.exitCode, 2, args.join(" "));
			assert.match(stderr, /^Parse error: /);
			assert.equal(process.listenerCount("SIGINT"), originalSignalListeners);
		}
		assert.equal(stdout.mock.callCount(), 0);
	} finally {
		process.exitCode = originalExitCode;
	}
});
