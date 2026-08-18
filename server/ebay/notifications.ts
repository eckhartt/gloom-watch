import { createHash } from "node:crypto";
import { Hono } from "hono";
import { EBAY_ACCOUNT_DELETION_PATH } from "../../shared/gate.ts";
import type { GloomDatabase } from "../db/client.ts";
import { deleteListingsBySellerHash } from "./repository.ts";
import { hashSellerUsername } from "./seller-hash.ts";

/**
 * eBay marketplace account-deletion notifications.
 *
 * Subscribe, not opt-out: this path is the public HTTPS callback the production keyset
 * requires. eBay sends a GET with `challenge_code` to prove we own the URL, then POSTs when
 * a user asks to be forgotten.
 *
 * The username in that POST is eBay user data. It is hashed with `RELIST_HASH_SALT` and used
 * to drop matching listing rows, then discarded. It is never written, never logged.
 */

export const VERIFICATION_TOKEN_ENV = "EBAY_NOTIFICATION_VERIFICATION_TOKEN";

export function challengeResponse(
	challengeCode: string,
	verificationToken: string,
	endpoint: string,
): string {
	return createHash("sha256")
		.update(challengeCode, "utf8")
		.update(verificationToken, "utf8")
		.update(endpoint, "utf8")
		.digest("hex");
}

export function notificationEndpoint(publicOrigin: string): string {
	return `${publicOrigin.replace(/\/$/, "")}${EBAY_ACCOUNT_DELETION_PATH}`;
}

export interface NotificationRouteDeps {
	readonly db: GloomDatabase;
	readonly publicOrigin: string;
	readonly verificationToken: string | null;
	readonly relistHashSalt: string | null;
}

function readUsername(payload: unknown): string | null {
	if (typeof payload !== "object" || payload === null) return null;
	const notification = (payload as { notification?: unknown }).notification;
	if (typeof notification !== "object" || notification === null) return null;
	const data = (notification as { data?: unknown }).data;
	if (typeof data !== "object" || data === null) return null;
	const username = (data as { username?: unknown }).username;
	return typeof username === "string" && username !== "" ? username : null;
}

export function createNotificationRoutes(deps: NotificationRouteDeps): Hono {
	const routes = new Hono();

	routes.get(EBAY_ACCOUNT_DELETION_PATH, (c) => {
		c.header("Cache-Control", "no-store");
		const challenge = c.req.query("challenge_code");
		if (challenge === undefined || challenge === "") {
			return c.json({ error: "challenge_code is required" }, 400);
		}
		if (deps.verificationToken === null) {
			return c.json({ error: "eBay notification verification is not configured" }, 503);
		}
		const endpoint = notificationEndpoint(deps.publicOrigin);
		return c.json({
			challengeResponse: challengeResponse(challenge, deps.verificationToken, endpoint),
		});
	});

	routes.post(EBAY_ACCOUNT_DELETION_PATH, async (c) => {
		c.header("Cache-Control", "no-store");
		let payload: unknown;
		try {
			payload = await c.req.json();
		} catch {
			return c.json({ error: "the request body must be JSON" }, 400);
		}

		const username = readUsername(payload);
		if (username !== null && deps.relistHashSalt !== null) {
			const hash = hashSellerUsername(username, deps.relistHashSalt);
			deleteListingsBySellerHash(deps.db, hash);
		}

		return c.body(null, 204);
	});

	return routes;
}
