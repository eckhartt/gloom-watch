import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
	EBAY_ACCOUNT_DELETION_PATH,
	GATE_COOKIE,
	UNLOCK_API_PATH,
	UNLOCK_PATH,
} from "../shared/gate.ts";

/**
 * The perimeter now that the origin is public.
 *
 * Unconfigured, this is a no-op — every existing test and every development machine. Configured,
 * `/api/*` needs the cookie or a bearer, except the unlock POST and the eBay callback. Static
 * shell assets stay public; they carry no collection data. Card images live under `/api` and
 * so they are gated.
 */

export const SHARED_SECRET_ENV = "GLOOM_WATCH_SHARED_SECRET";

export function readSharedSecret(
	env: Record<string, string | undefined> = process.env,
): string | null {
	const value = env[SHARED_SECRET_ENV];
	return value !== undefined && value !== "" ? value : null;
}

export function sessionToken(secret: string): string {
	return createHmac("sha256", secret).update("gloom-watch-gate-v1", "utf8").digest("hex");
}

function bytesEqual(left: string, right: string): boolean {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

export function presentedSecret(c: Context, secret: string): boolean {
	const expected = sessionToken(secret);
	const cookie = getCookie(c, GATE_COOKIE);
	if (cookie !== undefined && bytesEqual(cookie, expected)) return true;

	const header = c.req.header("authorization");
	if (header?.toLowerCase().startsWith("bearer ")) {
		const offered = header.slice(7).trim();
		return bytesEqual(offered, secret) || bytesEqual(offered, expected);
	}
	return false;
}

export function isPublicApiPath(pathname: string): boolean {
	return pathname === UNLOCK_API_PATH || pathname === EBAY_ACCOUNT_DELETION_PATH;
}

export function gateMiddleware(secret: string | null) {
	return async (c: Context, next: Next) => {
		if (secret === null) return next();
		const path = new URL(c.req.url).pathname;
		if (!path.startsWith("/api/")) return next();
		if (isPublicApiPath(path)) return next();
		if (presentedSecret(c, secret)) return next();

		c.header("Cache-Control", "no-store");
		return c.json({ error: "unlock required", unlock: UNLOCK_PATH }, 401);
	};
}

export function attachGateCookie(c: Context, secret: string, publicOrigin: string): void {
	const secure = publicOrigin.startsWith("https://");
	setCookie(c, GATE_COOKIE, sessionToken(secret), {
		path: "/",
		httpOnly: true,
		sameSite: "Lax",
		secure,
		maxAge: 60 * 60 * 24 * 365,
	});
}

export function clearGateCookie(c: Context, publicOrigin: string): void {
	deleteCookie(c, GATE_COOKIE, {
		path: "/",
		secure: publicOrigin.startsWith("https://"),
	});
}

export function unlockPageHtml(): string {
	return `<!doctype html>
<html lang="en-AU">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gloom Watch</title>
<style>
  :root { color-scheme: dark; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  body { margin: 0; background: #0c1310; color: #e6efe9; }
  main { max-width: 22rem; margin: 0 auto; padding: 2.5rem 1.25rem; }
  h1 { font-size: 1.25rem; letter-spacing: -0.02em; }
  p { color: #8ba396; font-size: 0.8125rem; line-height: 1.5; }
  label { display: block; font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; color: #8ba396; margin: 1.25rem 0 0.4rem; }
  input { width: 100%; box-sizing: border-box; font: inherit; padding: 0.7rem 0.75rem; color: #e6efe9; background: #121c17; border: 1px solid #22322a; border-radius: 6px; }
  button { margin-top: 1rem; font: inherit; font-size: 0.8125rem; min-height: 2.75rem; padding: 0 1rem; color: #0c1310; background: #86e08f; border: 0; border-radius: 6px; }
  .error { color: #ef8a7a; }
</style>
<main>
  <h1>Gloom Watch</h1>
  <p>The collection is on a public hostname. The shared secret is in the environment file.</p>
  <form method="post" action="${UNLOCK_API_PATH}">
    <label for="secret">Shared secret</label>
    <input id="secret" name="secret" type="password" autocomplete="current-password" required>
    <button type="submit">Unlock</button>
  </form>
</main>
`;
}
