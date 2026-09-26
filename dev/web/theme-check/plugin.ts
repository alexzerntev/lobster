import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath, searchForWorkspaceRoot, type Plugin } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const assetPrefix = "/__openclaw-theme-assets/";

/** Source compatibility check, loaded only when an OpenClaw checkout is explicitly selected. */
export function createOpenClawThemeCheck(root = process.env.LOBSTER_OPENCLAW_ROOT): Plugin {
	if (!root) throw new Error("Set LOBSTER_OPENCLAW_ROOT to an OpenClaw source checkout.");
	const checkout = path.resolve(root);
	const source = (relative: string) => normalizePath(path.join(checkout, relative));
	const producer = source("ui/src/app/bootstrap-theme.ts");
	const publicAssets = source("ui/src/app/public-assets.ts");
	const preferences = source("ui/src/app/settings.ts");
	const stylesheet = source("ui/src/styles/base.css");
	const required = [
		producer,
		publicAssets,
		preferences,
		stylesheet,
		source("ui/public/themes/knot.css"),
	];
	for (const filename of required) {
		if (!existsSync(filename)) {
			throw new Error(`OpenClaw theme check requires this source contract: ${filename}`);
		}
	}
	const virtualAssets = "\0lobster-openclaw-theme-assets";
	return {
		name: "lobster-openclaw-theme-check",
		enforce: "pre",
		config(config) {
			return {
				server: {
					fs: {
						allow: [
							...(config.server?.fs?.allow ?? [searchForWorkspaceRoot(process.cwd())]),
							checkout,
						],
					},
				},
			};
		},
		resolveId(id, importer) {
			if (id === "virtual:lobster-theme-driver") return path.join(here, "driver.ts");
			if (id === "virtual:lobster-openclaw-theme-producer") return producer;
			if (id === "virtual:lobster-openclaw-theme-styles") return stylesheet;
			if (!importer) return;
			const resolved = normalizePath(path.resolve(path.dirname(importer), id));
			if (resolved === preferences && normalizePath(importer) === producer) {
				return path.join(here, "preferences.ts");
			}
			if (resolved === publicAssets) return virtualAssets;
			const normalization =
				/^@openclaw\/normalization-core\/(record-coerce|string-coerce|utf16-slice)$/u.exec(id);
			if (normalization) {
				return source(`packages/normalization-core/src/${normalization[1]}.ts`);
			}
		},
		load(id) {
			if (id === virtualAssets) {
				return `export const inferControlUiPublicAssetPath = asset => ${JSON.stringify(assetPrefix)} + asset;`;
			}
		},
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				const url = new URL(request.url ?? "/", "http://theme-check.invalid");
				if (!url.pathname.startsWith(assetPrefix)) return next();
				const asset = url.pathname.slice(assetPrefix.length);
				if (!/^(themes|fonts)\/[a-z0-9_-]+\.(css|woff2)$/u.test(asset)) {
					response.writeHead(404).end();
					return;
				}
				const filename = source(`ui/public/${asset}`);
				if (!existsSync(filename)) {
					response.writeHead(404).end();
					return;
				}
				response.setHeader("Content-Type", asset.endsWith(".css") ? "text/css" : "font/woff2");
				response.end(readFileSync(filename));
			});
		},
	};
}
