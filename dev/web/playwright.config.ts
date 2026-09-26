import path from "node:path";
import os from "node:os";
import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./browser",
	outputDir: path.join(os.tmpdir(), "lobster-theme-browser-results"),
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	use: { baseURL: "http://127.0.0.1:5192", viewport: { width: 1280, height: 900 } },
	testMatch: "theme.spec.ts",
	webServer: {
		command: "tsx server.ts",
		url: "http://127.0.0.1:5192/api/health",
		reuseExistingServer: false,
		gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
		env: {
			LOBSTER_WEB_HOST: "127.0.0.1",
			LOBSTER_WEB_PORT: "5192",
			LOBSTER_WORKSPACE: path.resolve(import.meta.dirname, "workspace"),
		},
	},
});
