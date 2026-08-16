import { describe, expect, it } from "vitest";
import type { PushNotificationContent } from "../shared/push.ts";
import {
	buildClassicPayload,
	buildDeclarativePayload,
	DECLARATIVE_WEB_PUSH_MAGIC,
	MANIFEST_SCOPE,
	PUSH_PAYLOAD_MAX_BYTES,
	PUSH_TTL_SECONDS,
	PushPayloadTooLargeError,
	resolveNavigateTarget,
	serialisePushPayload,
} from "../shared/push.ts";

const ORIGIN = "https://htpc.tail594f35.ts.net";

const content: PushNotificationContent = {
	title: "Gloom — Jungle JA holo",
	body: "¥4,200 — ungraded — auction 3d",
	navigate: `${ORIGIN}/listings/v1|123456789|0`,
	lang: "ja",
};

describe("the declarative payload", () => {
	it("carries the magic number and the two required members", () => {
		const payload = buildDeclarativePayload(content);
		expect(payload.web_push).toBe(DECLARATIVE_WEB_PUSH_MAGIC);
		expect(payload.web_push).toBe(8030);
		expect(payload.notification.title).toBe(content.title);
		expect(payload.notification.navigate).toBe(content.navigate);
	});

	it("never sets `mutable`", () => {
		// `mutable: true` dispatches a push event to the service worker carrying the proposed
		// notification — which re-arms the 30-second silent-push timer and forfeits the exemption
		// that is the whole reason for choosing this transport.
		const serialised = JSON.stringify(buildDeclarativePayload(content));
		expect(serialised).not.toContain("mutable");
	});

	it("uses the JSON member name `app_badge`, not a camel-cased one", () => {
		const payload = buildDeclarativePayload({ ...content, appBadge: 7 });
		expect(payload.notification.app_badge).toBe(7);
		expect(JSON.stringify(payload)).not.toContain("appBadge");
	});

	it("refuses a payload with no title or no navigate target", () => {
		expect(() => buildDeclarativePayload({ ...content, title: "  " })).toThrow(/title is empty/);
		expect(() => buildDeclarativePayload({ ...content, navigate: "" })).toThrow(
			/navigate is empty/,
		);
	});
});

describe("one shape, never both", () => {
	it("keeps the magic number out of the classic payload entirely", () => {
		// A user agent opportunistically parses every incoming message looking for `web_push`, so a
		// classic payload carrying it would be rendered by the platform *and* by our worker.
		expect(buildClassicPayload(content)).not.toHaveProperty("web_push");
		expect(buildClassicPayload(content)).not.toHaveProperty("notification");
	});

	it("puts the magic number in the declarative payload only", () => {
		expect(serialisePushPayload(content, "declarative").body).toContain('"web_push":8030');
		expect(serialisePushPayload(content, "classic").body).not.toContain("web_push");
	});

	it("puts the classic payload's fields at the top level, with no notification envelope", () => {
		const classic = JSON.parse(serialisePushPayload(content, "classic").body);
		expect(classic).toMatchObject({ title: content.title, body: content.body });
		expect(classic).not.toHaveProperty("notification");
	});

	it("nests the declarative payload's fields under `notification`", () => {
		const declarative = JSON.parse(serialisePushPayload(content, "declarative").body);
		expect(declarative).not.toHaveProperty("title");
		expect(declarative.notification.title).toBe(content.title);
	});
});

describe("the payload budget", () => {
	it("measures bytes, not characters", () => {
		// A Japanese card name is three bytes a character in UTF-8, and the RFC 8291 ceiling is
		// denominated in bytes. Measuring `body.length` would under-count by a factor of three on
		// exactly the cards this collection is mostly made of.
		const japanese = { ...content, title: "クサイハナ", body: "ジャングル" };
		const serialised = serialisePushPayload(japanese, "classic");
		expect(serialised.bytes).toBeGreaterThan(serialised.body.length);
	});

	it("refuses a payload over the budget rather than letting Apple refuse it", () => {
		const enormous = { ...content, body: "x".repeat(PUSH_PAYLOAD_MAX_BYTES) };
		expect(() => serialisePushPayload(enormous, "declarative")).toThrow(PushPayloadTooLargeError);
	});

	it("leaves headroom under the RFC 8291 record limit", () => {
		// 4096 bytes encrypted, minus 16 salt + 4 record size + 1 id length + 65 ephemeral key +
		// 16 auth tag + 1 padding delimiter = 3993 of plaintext. The budget sits below it.
		expect(PUSH_PAYLOAD_MAX_BYTES).toBeLessThan(3993);
	});

	it("keeps a realistic instant notification well inside the budget", () => {
		expect(serialisePushPayload(content, "declarative").bytes).toBeLessThan(300);
	});
});

describe("the TTL", () => {
	it("is positive, because Apple answers a non-positive TTL with BadTtl", () => {
		expect(PUSH_TTL_SECONDS).toBeGreaterThan(0);
		expect(Number.isInteger(PUSH_TTL_SECONDS)).toBe(true);
	});
});

describe("the navigate target", () => {
	it("resolves a path against the app's own origin", () => {
		expect(resolveNavigateTarget(ORIGIN, "/listings/abc")).toBe(`${ORIGIN}/listings/abc`);
		expect(resolveNavigateTarget(ORIGIN, MANIFEST_SCOPE)).toBe(`${ORIGIN}/`);
	});

	it("refuses an off-origin target", () => {
		expect(() => resolveNavigateTarget(ORIGIN, "https://www.ebay.com/itm/123")).toThrow(
			/not same-origin/,
		);
	});

	it("survives path encoding of an eBay item id", () => {
		// eBay's item identifiers carry pipes. A target that does not survive encoding opens
		// nothing, and the notification has spent the owner's attention for it.
		const target = resolveNavigateTarget(ORIGIN, `/listings/${encodeURIComponent("v1|1234|0")}`);
		expect(new URL(target).pathname).toBe("/listings/v1%7C1234%7C0");
		expect(decodeURIComponent(new URL(target).pathname)).toBe("/listings/v1|1234|0");
	});
});
