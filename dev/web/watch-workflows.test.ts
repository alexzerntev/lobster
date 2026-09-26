import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { watchWorkflows } from "../../ui/server/watch-workflows.js";

test(
	"watcher discovers a workflows directory created after startup and watches its replacement",
	{ timeout: 3000 },
	async (t) => {
		const workspace = await mkdtemp(path.join(os.tmpdir(), "lobster-watch-test-"));
		const directory = path.join(workspace, "workflows");
		let changed: (() => void) | undefined;
		let failed: ((error: unknown) => void) | undefined;
		const errors: unknown[] = [];
		const watcher = watchWorkflows(
			workspace,
			() => changed?.(),
			(error) => {
				errors.push(error);
				failed?.(error);
			},
		);
		t.after(async () => {
			await watcher.close();
			await rm(workspace, { recursive: true, force: true });
		});
		const expectChange = async (mutate: () => Promise<unknown>) => {
			const notification = new Promise<void>((resolve, reject) => {
				changed = resolve;
				failed = reject;
			});
			await mutate();
			await notification;
			changed = undefined;
			failed = undefined;
		};
		await watcher.ready;
		await expectChange(async () => {
			await mkdir(directory);
			await writeFile(path.join(directory, "first.lobster"), "name: First\nsteps: []\n");
		});
		await expectChange(() => rm(directory, { recursive: true }));
		await expectChange(async () => {
			await mkdir(directory);
			await writeFile(
				path.join(directory, "replacement.lobster"),
				"name: Replacement\nsteps: []\n",
			);
		});
		await watcher.close();
		assert.deepEqual(errors, []);
	},
);
