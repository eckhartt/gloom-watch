import { registerSW } from "virtual:pwa-register";

/**
 * Register the service worker at `/`.
 *
 * The scope is load-bearing and must never move: a push subscription keys to the scope, not
 * just the origin, so relocating the worker silently orphans every subscription taken under the
 * old one. `sw.js` is served with `Cache-Control: no-cache` by the server for the mirror-image
 * reason — a cached worker pins the phone to old code permanently.
 */
export function registerServiceWorker(): void {
	if (!("serviceWorker" in navigator)) return;

	registerSW({
		immediate: true,
		onRegisteredSW(_swScriptUrl, registration) {
			if (registration === undefined) return;
			// iOS backgrounds a Home Screen web app rather than closing it, so `visibilitychange`
			// is the only reliable moment to ask whether a newer worker exists.
			document.addEventListener("visibilitychange", () => {
				if (document.visibilityState === "visible") {
					void registration.update();
				}
			});
		},
	});
}

/** The scope the worker actually took, for the commissioning check on the device itself. */
export async function serviceWorkerScope(): Promise<string | null> {
	if (!("serviceWorker" in navigator)) return null;
	const registration = await navigator.serviceWorker.ready;
	return registration.scope;
}
