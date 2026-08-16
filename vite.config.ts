import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	base: "/",
	publicDir: "public",
	build: {
		outDir: "dist/client",
		emptyOutDir: true,
		sourcemap: true,
	},
	server: {
		port: 5173,
		// Development only. In production Hono serves both the API and `dist/client`, so there is
		// one origin and the service worker's scope question never arises.
		proxy: {
			"/api": { target: "http://127.0.0.1:3000", changeOrigin: false },
		},
	},
	plugins: [
		react(),
		VitePWA({
			/**
			 * `injectManifest`, never `generateSW`. Workbox's generated worker cannot host the
			 * custom `push` handler a later ticket needs, and discovering that after the phone is
			 * commissioned means re-registering the worker and losing the subscription.
			 */
			strategies: "injectManifest",
			srcDir: "client",
			filename: "sw.ts",

			/** Take the new worker immediately; `client/sw.ts` does the matching skipWaiting. */
			registerType: "autoUpdate",

			/**
			 * Registration is written by hand in `client/pwa.ts` rather than injected, so the
			 * scope is visible in reviewable source. The scope is `/` and must never move: push
			 * subscriptions key to the scope, not merely to the origin.
			 */
			injectRegister: null,
			scope: "/",

			// No `includeAssets`: the glob below already precaches everything in `public/`, and
			// listing them twice puts duplicate entries in the precache manifest.

			manifest: {
				id: "/",
				name: "Gloom Watch",
				short_name: "Gloom Watch",
				description: "Masterset tracker for the Pokemon Oddish line.",
				lang: "en-AU",
				scope: "/",
				start_url: "/",
				/**
				 * NON-DEFAULT AND LOAD-BEARING. On iOS the `Notification` constructor throws
				 * `ReferenceError` unless the page is a Home Screen web app whose manifest sets
				 * `display` to something other than `browser` — and the failure surfaces only
				 * once push is wired up, tickets later.
				 */
				display: "standalone",
				orientation: "portrait",
				background_color: "#0c1310",
				theme_color: "#0c1310",
				icons: [
					{ src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
					{ src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
					{
						src: "pwa-maskable-512x512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "maskable",
					},
				],
			},

			injectManifest: {
				globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
			},

			devOptions: {
				// The worker is exercised against the built app served by Hono over
				// `http://localhost`, which is a secure context. Running it under the Vite dev
				// server as well would mean two registrations racing for one scope.
				enabled: false,
				type: "module",
			},
		}),
	],
});
