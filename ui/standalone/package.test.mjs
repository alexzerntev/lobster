import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));

test(
	"installed view serves built assets and live inspection without executing workflows",
	{ timeout: 90_000 },
	async (t) => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "lobster-view-package-"));
		let child;
		let exited;
		t.after(async () => {
			if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			await exited;
			await rm(directory, { recursive: true, force: true });
		});
		const artifact = path.join(directory, "lobster.tgz");
		await exec("pnpm", ["pack", "--out", artifact], { cwd: root, signal: t.signal });
		await writeFile(path.join(directory, "package.json"), '{"private":true,"type":"module"}\n');
		await exec("pnpm", ["add", "--prod", "--prefer-offline", "--ignore-scripts", artifact], {
			cwd: directory,
			signal: t.signal,
		});
		const installed = path.join(directory, "node_modules/@clawdbot/lobster");
		const packedFiles = (await readdir(installed, { recursive: true })).map((name) =>
			name.split(path.sep).join("/"),
		);
		assert.ok(packedFiles.includes("dist/view/index.html"));
		assert.ok(packedFiles.includes("dist/ui/standalone/server.js"));
		assert.ok(!packedFiles.some((name) => /^(?:dev|ui|test)\//.test(name)));
		assert.ok(!packedFiles.some((name) => /(?:^|\/)(?:vite\.config|.*\.test)\.[^/]+$/.test(name)));
		const manifest = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"));
		assert.equal(manifest.dependencies.vite, undefined);
		assert.equal(manifest.dependencies.tsx, undefined);

		const workspace = path.join(directory, "workspace");
		const workflows = path.join(workspace, "workflows");
		await mkdir(workflows, { recursive: true });
		const marker = path.join(directory, "executed");
		const helper = path.join(workflows, "helper.js");
		const helperSource = `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'executed');\nthrow new Error('Inspection must never execute this file');\n`;
		await writeFile(helper, helperSource);
		const definition = (name) =>
			`name: ${name}\nsteps:\n  - id: inspect\n    command: |\n      node ${JSON.stringify(helper)}\n`;
		const filename = path.join(workflows, "inspect.lobster");
		await writeFile(filename, definition("Inspect"));
		const id = `file:${Buffer.from("inspect.lobster").toString("base64url")}`;
		let output = "";
		let errors = "";
		child = spawn(
			process.execPath,
			[path.join(installed, "bin/lobster.js"), "view", "--workspace", workspace, "--port", "0"],
			{
				cwd: directory,
				env: { ...process.env, NODE_ENV: "production" },
				stdio: ["ignore", "pipe", "pipe"],
				signal: t.signal,
			},
		);
		exited = new Promise((resolve) => child.once("close", (...result) => resolve(result)));
		child.stderr.setEncoding("utf8").on("data", (text) => {
			errors += text;
		});
		const url = await new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (code) => reject(new Error(`view exited ${code}: ${output}\n${errors}`)));
			child.stdout.setEncoding("utf8").on("data", (text) => {
				output += text;
				const address = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
				if (address) resolve(address);
			});
		});
		const get = (pathname, options = {}) =>
			fetch(new URL(pathname, url), { signal: t.signal, ...options });
		const json = async (pathname) => {
			const response = await get(pathname);
			assert.equal(response.status, 200, pathname);
			return response.json();
		};
		for (const [args, message] of [
			[["--port", new URL(url).port], /EADDRINUSE/],
			[
				["--workspace", path.join(directory, "missing"), "--port", "0"],
				/existing, readable workspace/,
			],
		]) {
			await assert.rejects(
				exec(process.execPath, [path.join(installed, "bin/lobster.js"), "view", ...args], {
					cwd: workspace,
					env: { ...process.env, NODE_ENV: "production" },
					signal: t.signal,
					timeout: 10_000,
				}),
				(error) => {
					assert.equal(error.code, 1, "Startup failure must exit and release its watcher");
					assert.match(error.stderr, message);
					return true;
				},
			);
		}
		const page = await get(`/workflow?id=${encodeURIComponent(id)}`);
		assert.equal(page.status, 200);
		assert.match(page.headers.get("content-type"), /text\/html/);
		const html = await page.text();
		assert.match(html, /id="app"/);
		assert.doesNotMatch(html, /@vite\/client|\/main\.ts/);
		const assets = [...html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)].map(
			(match) => match[1],
		);
		assert.ok(assets.some((asset) => asset.endsWith(".js")));
		assert.ok(assets.some((asset) => asset.endsWith(".css")));
		for (const asset of assets) {
			const response = await get(asset);
			assert.equal(response.status, 200, asset);
			assert.match(
				response.headers.get("content-type"),
				asset.endsWith(".css") ? /text\/css/ : /(?:text|application)\/javascript/,
			);
			if (asset.endsWith(".css")) {
				const css = await response.text();
				const themeAssets = [...css.matchAll(/url\(["']?([^)'"\s]+\.(?:woff2|webp))["']?\)/g)].map(
					(match) => match[1],
				);
				assert.ok(
					themeAssets.some((file) => file.endsWith(".woff2")),
					"The theme includes local fonts",
				);
				assert.ok(
					themeAssets.some((file) => file.endsWith(".webp")),
					"The theme includes its artwork",
				);
				for (const file of new Set(themeAssets)) {
					const themeResponse = await get(new URL(file, new URL(asset, url)));
					assert.equal(themeResponse.status, 200, file);
					assert.match(
						themeResponse.headers.get("content-type"),
						file.endsWith(".woff2") ? /font\/woff2/ : /image\/webp/,
					);
					assert.equal(
						Buffer.from(await themeResponse.arrayBuffer())
							.subarray(0, 4)
							.toString(),
						file.endsWith(".woff2") ? "wOF2" : "RIFF",
					);
				}
			} else await response.arrayBuffer();
		}
		const builtin = await json("/api/workflow?id=builtin%3Agithub.pr.monitor");
		assert.equal(
			builtin.workflow.definition.text,
			await readFile(path.join(root, "src/workflows/github_pr_monitor.ts"), "utf8"),
		);
		const detailPath = `/api/workflow?id=${encodeURIComponent(id)}`;
		const workflow = (await json(detailPath)).workflow;
		assert.equal(workflow.definition.text, definition("Inspect"));
		assert.equal(workflow.graph.nodes[0].type, "run");
		assert.equal(
			(await json(`/api/workflow/file?id=${encodeURIComponent(id)}&path=helper.js`)).file.text,
			helperSource,
		);
		assert.ok(
			(await json(`/api/workflow/files?id=${encodeURIComponent(id)}`)).files.some(
				(file) => file.path === "helper.js",
			),
		);
		assert.equal((await get("/api/workflows", { method: "POST" })).status, 405);
		assert.equal(
			(await get("/api/workflows", { headers: { Origin: "https://unrelated.example" } })).status,
			403,
		);
		assert.equal(
			(await get(`/api/workflow/file?id=${encodeURIComponent(id)}&path=../package.json`)).status,
			400,
		);
		// Fetch replaces Host and normalizes dot segments; send those boundary probes verbatim.
		const rawStatus = (options) =>
			new Promise((resolve, reject) => {
				const req = request(url, { ...options, signal: t.signal }, (response) => {
					response.resume();
					response.once("end", () => resolve(response.statusCode));
				});
				req.once("error", reject);
				req.end();
			});
		assert.equal(
			await rawStatus({ path: "/api/workflows", headers: { Host: "unrelated.example" } }),
			403,
		);
		const traversal = await rawStatus({ path: "/%2e%2e/%2e%2e/package.json" });
		assert.ok([400, 403, 404].includes(traversal), "Static requests cannot escape built assets");

		const stream = await get("/api/events");
		assert.equal(stream.status, 200);
		assert.match(stream.headers.get("content-type"), /text\/event-stream/);
		const reader = stream.body.getReader();
		const decoder = new TextDecoder();
		let pending = "";
		const changed = async () => {
			for (;;) {
				let end;
				while ((end = pending.indexOf("\n\n")) !== -1) {
					const event = pending.slice(0, end);
					pending = pending.slice(end + 2);
					if (/^event: workflows-changed$/m.test(event)) return;
				}
				const chunk = await reader.read();
				assert.equal(chunk.done, false, "Change stream ended before notification");
				pending += decoder.decode(chunk.value, { stream: true });
			}
		};
		await changed();
		const added = path.join(workflows, "added.lobster");
		await writeFile(added, definition("Added"));
		await changed();
		assert.ok((await json("/api/workflows")).workflows.some((entry) => entry.name === "Added"));
		await writeFile(filename, definition("Updated"));
		await changed();
		assert.equal((await json(detailPath)).workflow.name, "Updated");
		await rm(added);
		await changed();
		assert.ok(!(await json("/api/workflows")).workflows.some((entry) => entry.name === "Added"));
		await assert.rejects(stat(marker), { code: "ENOENT" });
		child.kill("SIGTERM");
		if (process.platform === "win32") {
			// Windows terminates on SIGTERM instead of delivering it to Node's handler.
			assert.deepEqual(await exited, [null, "SIGTERM"], errors);
			await reader.cancel();
		} else {
			assert.deepEqual(await exited, [143, null], errors);
			while (!(await reader.read()).done) {
				/* Drain a final notification before EOF. */
			}
		}
		reader.releaseLock();
		const released = createServer();
		t.after(() => {
			if (released.listening) released.close();
		});
		released.listen(Number(new URL(url).port), "127.0.0.1");
		await once(released, "listening");
		await new Promise((resolve, reject) =>
			released.close((error) => (error ? reject(error) : resolve())),
		);
	},
);
