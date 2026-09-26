import path from "node:path";
import { copyFile } from "node:fs/promises";
import { defineConfig } from "vite";

const ui = path.resolve(import.meta.dirname, "../../ui");
const output = path.resolve(ui, "../dist/view");

export default defineConfig({
	root: path.join(ui, "standalone"),
	publicDir: false,
	resolve: {
		dedupe: ["react", "react-dom"],
		alias: { "@clawdbot/lobster-viewer": path.join(ui, "src/index.ts") },
	},
	build: { outDir: output, emptyOutDir: true },
	plugins: [
		{
			name: "lobster-standalone-assets",
			apply: "build",
			async closeBundle() {
				await copyFile(path.join(ui, "theme/NOTICE.md"), path.join(output, "THEME_NOTICE.md"));
				await copyFile(
					path.join(ui, "THIRD_PARTY_NOTICES.md"),
					path.join(output, "THIRD_PARTY_NOTICES.md"),
				);
				// The source explorer reads this built-in as text, never as executable code.
				await copyFile(
					path.resolve(ui, "../src/workflows/github_pr_monitor.ts"),
					path.resolve(output, "../src/workflows/github_pr_monitor.ts"),
				);
			},
		},
	],
});
