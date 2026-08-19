import { afterEach, beforeEach, describe, expect, it } from "vitest";
import webpush from "web-push";
import { createApp } from "../server/app.ts";
import { DEFAULT_CLIENT_DIR, resolveFromRepo } from "../server/config.ts";
import { insertCopy, setVariantPriority } from "../server/copies/repository.ts";
import { seedInitialState } from "../server/db/app-state.ts";
import { readListing, upsertObserved } from "../server/ebay/repository.ts";
import { whitelistItem } from "../server/ebay/whitelist.ts";
import { upsertSubscription } from "../server/push/subscriptions.ts";
import { triggerInstantPush } from "../server/push/trigger.ts";
import type { VapidConfig } from "../server/push/vapid.ts";
import { COPY_CONDITIONS } from "../shared/copies.ts";
import type { ListingDocument } from "../shared/listings.ts";
import { listingFeedPath, listingPath } from "../shared/listings.ts";
import { formatMoney } from "../shared/money.ts";
import { buildDeclarativePayload, serialisePushPayload } from "../shared/push.ts";
import {
	buildInstantPushContent,
	decidePushDisposition,
	instantPushSubject,
} from "../shared/push-policy.ts";
import {
	FIRST_EDITION_VARIANT,
	SHARED_VARIANT,
	seedBinderCorpus,
} from "./helpers/binder-fixture.ts";
import { FIXTURE_SALT, fixtureSummary } from "./helpers/fake-ebay.ts";
import { createFakeDevice, startFakePushService } from "./helpers/push-receiver.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/**
 * The trigger, against a stand-in push service. The function under test is the shipped one;
 * the receiver is the same fake the transport ticket used. A physical iPhone is not available
 * here, so delivery is proved up to decryption, not up to a banner on a handset.
 */

const VAPID: VapidConfig = {
	...webpush.generateVAPIDKeys(),
	subject: "mailto:gloom-watch@example.org",
};

const NOW = 1_800_000_000_000;
const ORIGIN = "https://htpc.tail594f35.ts.net";
const GLOOM = { cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT };

const CONDITION_GRADE = new RegExp(
	`\\b(?:${[...COPY_CONDITIONS, "Near Mint", "Very Good", "Excellent", "Poor"].join("|")})\\b`,
	"i",
);

describe("the push policy", () => {
	it("sends instant only when unowned, confident, not a lot or proxy, and at the priority bar", () => {
		const match = {
			grain: "card" as const,
			cardKey: "en:base2-44",
			variantId: null,
			candidates: [
				{
					cardKey: "en:base2-44",
					variantId: FIRST_EDITION_VARIANT,
					finish: "normal",
					subtype: null,
					stamps: ["1st-edition"],
					foil: null,
					size: "standard",
				},
				{
					cardKey: "en:base2-44",
					variantId: SHARED_VARIANT,
					finish: "normal",
					subtype: "unlimited",
					stamps: [],
					foil: null,
					size: "standard",
				},
			],
			language: "en",
			confidence: 0.92,
			matcherVersion: "matcher-1",
			isLot: false,
			lotNames: null,
			filterVerdict: "pass" as const,
			filterReason: null,
			parsedGrader: null,
			parsedGrade: null,
		};
		const high = new Map([[`${GLOOM.cardKey} ${GLOOM.variantId}`, 3]]);

		expect(decidePushDisposition({ match, owned: new Set(), priorities: high })).toBe("instant");
		expect(
			decidePushDisposition({
				match,
				owned: new Set([`${GLOOM.cardKey} ${GLOOM.variantId}`]),
				priorities: high,
			}),
		).toBe("nothing");
		expect(decidePushDisposition({ match, owned: new Set(), priorities: new Map() })).toBe(
			"digest",
		);
		expect(
			decidePushDisposition({
				match: { ...match, isLot: true, grain: "none", cardKey: null, candidates: null },
				owned: new Set(),
				priorities: high,
			}),
		).toBe("nothing");
		expect(
			decidePushDisposition({
				match: { ...match, filterVerdict: "filtered", filterReason: "proxy" },
				owned: new Set(),
				priorities: high,
			}),
		).toBe("nothing");
		expect(
			decidePushDisposition({
				match: { ...match, confidence: 0.5 },
				owned: new Set(),
				priorities: high,
			}),
		).toBe("nothing");
	});
});

describe("triggering an instant push", () => {
	let temp: TempDatabase;
	let service: ReturnType<typeof startFakePushService>;
	let device: ReturnType<typeof createFakeDevice>;

	beforeEach(() => {
		temp = createTempDatabase();
		seedInitialState(temp.handle.db, "Australia/Brisbane", NOW);
		seedBinderCorpus(temp.handle.db);
		service = startFakePushService();
		device = createFakeDevice();
	});

	afterEach(async () => {
		await service.stop();
		temp.dispose();
	});

	function persist(itemId: string, title: string): ListingDocument {
		const observed = whitelistItem(
			fixtureSummary({
				itemId,
				title,
				itemLocation: { country: "AU" },
				price: { value: "42.00", currency: "AUD" },
			}),
			FIXTURE_SALT,
		);
		if (observed === null) throw new Error("fixture must whitelist");
		upsertObserved(temp.handle.db, observed, "AU", NOW);
		const listing = readListing(temp.handle.db, itemId, NOW);
		if (listing === null) throw new Error("listing must persist");
		return listing;
	}

	function register() {
		return upsertSubscription(
			temp.handle.db,
			{
				endpoint: `${service.origin}/push/device-1`,
				keys: { p256dh: device.p256dh, auth: device.auth },
				transport: "declarative",
			},
			NOW,
		);
	}

	function trigger(listing: ListingDocument) {
		return triggerInstantPush(
			{ db: temp.handle.db, vapid: VAPID, publicOrigin: ORIGIN, now: () => NOW },
			listing,
		);
	}

	function flagHighPriority() {
		setVariantPriority(temp.handle.db, GLOOM.cardKey, GLOOM.variantId, 3, NOW);
	}

	it("sends for an unowned high-priority card-grain owns-none listing", async () => {
		register();
		flagHighPriority();
		const listing = persist("v1|need|0", "Gloom Jungle 44/64 Near Mint");
		expect(listing.match.grain).toBe("card");
		expect(listing.match.cardKey).toBe("en:base2-44");
		expect(listing.match.variantId).toBeNull();

		const result = await trigger(listing);

		expect(result.disposition).toBe("instant");
		expect(result.content).not.toBeNull();
		expect(service.received).toHaveLength(1);
		expect(result.outcomes[0]?.accepted).toBe(true);

		const plaintext = device.decrypt(service.received[0]?.body as Uint8Array);
		const payload = JSON.parse(plaintext) as unknown;
		expect(payload).toEqual(
			buildDeclarativePayload(result.content as NonNullable<typeof result.content>),
		);
		expect(plaintext).toBe(
			serialisePushPayload(result.content as NonNullable<typeof result.content>, "declarative")
				.body,
		);

		const content = result.content as NonNullable<typeof result.content>;
		expect(content.title).toContain("Gloom");
		expect(content.title).toContain("Jungle");
		expect(content.title).toMatch(/\bEN\b/);
		expect(content.body).toContain(formatMoney(4200, "AUD"));
		expect(content.body).toContain("ungraded");
		expect(content.body).toContain("buy it now");
		expect(content.navigate).toBe(`${ORIGIN}${listingFeedPath(listing.itemId)}`);

		const serialised = JSON.stringify(payload);
		expect(serialised).not.toMatch(/"image"/);
		expect(serialised).not.toMatch(/"actions"/);
		expect(serialised).not.toMatch(/"icon"/);
		expect(`${content.title} ${content.body}`).not.toMatch(CONDITION_GRADE);
	});

	it("sends nothing when the card is already owned", async () => {
		register();
		flagHighPriority();
		insertCopy(temp.handle.db, { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ...GLOOM }, NOW);
		insertCopy(
			temp.handle.db,
			{
				id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
				cardKey: "en:base2-44",
				variantId: SHARED_VARIANT,
			},
			NOW,
		);

		const result = await trigger(persist("v1|owned|0", "Gloom Jungle 44/64"));

		expect(result.disposition).toBe("nothing");
		expect(result.content).toBeNull();
		expect(service.received).toHaveLength(0);
	});

	it("sends nothing when priority is below the instant bar", async () => {
		register();
		setVariantPriority(temp.handle.db, GLOOM.cardKey, GLOOM.variantId, 1, NOW);

		const result = await trigger(persist("v1|low|0", "Gloom Jungle 44/64"));

		expect(result.disposition).toBe("digest");
		expect(result.content).toBeNull();
		expect(service.received).toHaveLength(0);
	});

	it("sends nothing for a lot", async () => {
		register();
		flagHighPriority();

		const listing = persist("v1|lot|0", "Pokemon Gloom Jungle 44/64 lot of 50");
		expect(listing.match.isLot).toBe(true);

		const result = await trigger(listing);

		expect(result.disposition).toBe("nothing");
		expect(service.received).toHaveLength(0);
	});

	it("sends nothing for a filtered proxy and leaves the listing in the feed", async () => {
		register();
		flagHighPriority();

		const listing = persist("v1|proxy|0", "Gloom Jungle 44/64 custom art proxy");
		expect(listing.match.filterVerdict).toBe("filtered");
		expect(listing.match.cardKey).toBe("en:base2-44");

		const result = await trigger(listing);

		expect(result.disposition).toBe("nothing");
		expect(service.received).toHaveLength(0);

		const app = createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			now: () => NOW,
		});
		const response = await app.request(listingPath(listing.itemId));
		expect(response.status).toBe(200);
		const body = (await response.json()) as ListingDocument;
		expect(body.match.filterVerdict).toBe("filtered");
		expect(body.match.cardKey).toBe("en:base2-44");
	});

	it("keeps the listing detail route resolving on a cold load, with the match attached", async () => {
		flagHighPriority();
		const listing = persist("v1|detail|0", "Gloom Jungle 44/64");
		const app = createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			now: () => NOW,
		});

		const response = await app.request(listingPath(listing.itemId));
		expect(response.status).toBe(200);
		const body = (await response.json()) as ListingDocument;
		expect(body.itemId).toBe(listing.itemId);
		expect(body.match.grain).toBe("card");
		expect(body.match.cardKey).toBe("en:base2-44");
		expect(body.match.matcherVersion).toBeTruthy();

		const subject = instantPushSubject(body, {
			cardKey: "en:base2-44",
			language: "en",
			cardId: "base2-44",
			setId: "base2",
			setName: "Jungle",
			setAbbreviation: "JU",
			localId: "44",
			name: "Gloom",
			variants: [],
		});
		expect(subject).not.toBeNull();
		const content = buildInstantPushContent(subject as NonNullable<typeof subject>, ORIGIN);
		expect(content.navigate).toBe(`${ORIGIN}/feed/${encodeURIComponent(listing.itemId)}`);
	});
});
