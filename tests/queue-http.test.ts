import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { DEFAULT_CLIENT_DIR, resolveFromRepo } from "../server/config.ts";
import { insertCopy } from "../server/copies/repository.ts";
import { seedInitialState } from "../server/db/app-state.ts";
import { copies } from "../server/db/schema.ts";
import { upsertObserved } from "../server/ebay/repository.ts";
import { whitelistItem } from "../server/ebay/whitelist.ts";
import type { HealthDocument } from "../shared/contract.ts";
import { HEALTH_PATH } from "../shared/contract.ts";
import type { ListingDocument } from "../shared/listings.ts";
import { listingPath } from "../shared/listings.ts";
import type {
	AliasDocument,
	AliasListDocument,
	QueueDocument,
	QueueResolutionDocument,
} from "../shared/queue.ts";
import {
	ALIASES_PATH,
	aliasPath,
	QUEUE_PATH,
	queueConfirmPath,
	queueRejectPath,
	queueVariantPath,
} from "../shared/queue.ts";
import {
	FIRST_EDITION_VARIANT,
	SHARED_VARIANT,
	seedBinderCorpus,
} from "./helpers/binder-fixture.ts";
import { FIXTURE_SALT, fixtureSummary } from "./helpers/fake-ebay.ts";
import { createTempDatabase, type TempDatabase } from "./helpers/temp-database.ts";

/**
 * The confirm queue and the aliases it teaches, driven through the shipped HTTP
 * handlers and `resolveListing`. Nothing here reimplements the matcher.
 */

const NOW = 1_800_000_000_000;
const ALIAS_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALIAS_TWO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COPY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const JAPANESE_PHRASE = "沼の花 キラレア";
const JUNGLE_TITLE = "Gloom Jungle 44/64";

describe("the confirm queue and aliases", () => {
	let temp: TempDatabase;

	beforeEach(() => {
		temp = createTempDatabase();
		seedInitialState(temp.handle.db, "Australia/Brisbane", NOW);
		seedBinderCorpus(temp.handle.db);
	});

	afterEach(() => {
		temp.dispose();
	});

	function app() {
		return createApp({
			handle: temp.handle,
			clientDir: resolveFromRepo(DEFAULT_CLIENT_DIR),
			now: () => NOW,
		});
	}

	function persist(itemId: string, title: string): void {
		const observed = whitelistItem(
			fixtureSummary({
				itemId,
				title,
				itemLocation: { country: "AU" },
			}),
			FIXTURE_SALT,
		);
		if (observed === null) throw new Error("fixture must whitelist");
		upsertObserved(temp.handle.db, observed, "AU", NOW);
	}

	async function queue(): Promise<QueueDocument> {
		const response = await app().request(QUEUE_PATH);
		expect(response.status).toBe(200);
		return (await response.json()) as QueueDocument;
	}

	async function listingOf(itemId: string): Promise<ListingDocument> {
		const response = await app().request(listingPath(itemId));
		expect(response.status).toBe(200);
		return (await response.json()) as ListingDocument;
	}

	it("keeps queue states explicit so not_a_match and unattempted stay distinguishable", async () => {
		persist("v1|a|0", JAPANESE_PHRASE);
		persist("v1|b|0", JAPANESE_PHRASE);

		const first = await listingOf("v1|a|0");
		expect(first.queueState).toBe("queued");
		expect(first.match.grain).toBe("none");

		const rejected = (await (
			await app().request(queueRejectPath("v1|b|0"), { method: "POST", body: "{}" })
		).json()) as QueueResolutionDocument;
		expect(rejected.queueState).toBe("not_a_match");

		const afterA = await listingOf("v1|a|0");
		const afterB = await listingOf("v1|b|0");
		expect(afterA.queueState).toBe("queued");
		expect(afterB.queueState).toBe("not_a_match");
		expect(afterA.queueState).not.toBe(afterB.queueState);

		const waiting = await queue();
		expect(waiting.listings.map((item) => item.listing.itemId)).toEqual(["v1|a|0"]);
	});

	it("never re-queues a listing resolved not_a_match", async () => {
		persist("v1|reject|0", JAPANESE_PHRASE);
		expect((await queue()).listings).toHaveLength(1);

		const rejected = await app().request(queueRejectPath("v1|reject|0"), {
			method: "POST",
			body: "{}",
		});
		expect(rejected.status).toBe(200);
		expect((await queue()).listings).toHaveLength(0);

		persist("v1|reject|0", `${JAPANESE_PHRASE} again`);
		await app().request(QUEUE_PATH);
		const listing = await listingOf("v1|reject|0");
		expect(listing.queueState).toBe("not_a_match");
		expect((await queue()).listings.map((item) => item.listing.itemId)).not.toContain(
			"v1|reject|0",
		);
	});

	it("confirms a phrasing, stores the alias, and does not re-queue the next listing with that phrasing", async () => {
		persist("v1|jp-1|0", JAPANESE_PHRASE);
		const waiting = await queue();
		expect(waiting.depth).toBe(1);
		expect(waiting.listings[0]?.listing.title).toBe(JAPANESE_PHRASE);
		expect(waiting.listings[0]?.match.grain).toBe("none");

		const confirmed = await app().request(queueConfirmPath("v1|jp-1|0"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				aliasId: ALIAS_ID,
				phrase: JAPANESE_PHRASE,
				cardKey: "ja:SV3-002",
			}),
		});
		expect(confirmed.status).toBe(200);
		const body = (await confirmed.json()) as QueueResolutionDocument;
		expect(body.queueState).toBe("resolved");
		expect(body.alias?.phrase).toBe(JAPANESE_PHRASE);
		expect(body.alias?.cardKey).toBe("ja:SV3-002");
		expect(body.alias?.variantId).toBeNull();
		expect(body.copy).toBeNull();

		const aliases = (await (await app().request(ALIASES_PATH)).json()) as AliasListDocument;
		expect(aliases.aliases).toHaveLength(1);
		expect(aliases.aliases[0]?.phrase).toBe(JAPANESE_PHRASE);
		expect(aliases.aliases[0]?.cardKey).toBe("ja:SV3-002");

		persist("v1|jp-2|0", JAPANESE_PHRASE);
		const after = await queue();
		expect(after.listings.map((item) => item.listing.itemId)).not.toContain("v1|jp-2|0");

		const second = await listingOf("v1|jp-2|0");
		expect(second.queueState).toBe("auto_matched");
		expect(second.match.grain).not.toBe("none");
		expect(second.match.cardKey).toBe("ja:SV3-002");
	});

	it("shows candidate variants side by side for a partly-owned card-grain listing", async () => {
		insertCopy(
			temp.handle.db,
			{ id: COPY_ID, cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT },
			1,
		);
		persist("v1|jungle|0", JUNGLE_TITLE);

		const waiting = await queue();
		const item = waiting.listings.find((entry) => entry.listing.itemId === "v1|jungle|0");
		expect(item).toBeDefined();
		expect(item?.match.grain).toBe("card");
		expect(item?.candidates).toHaveLength(2);
		const owned = item?.candidates?.find((c) => c.variantId === FIRST_EDITION_VARIANT);
		const needed = item?.candidates?.find((c) => c.variantId === SHARED_VARIANT);
		expect(owned?.ownedCopies).toBe(1);
		expect(needed?.ownedCopies).toBe(0);
	});

	it("teaches a variant-grain alias when the owner picks a variant", async () => {
		insertCopy(
			temp.handle.db,
			{ id: COPY_ID, cardKey: "en:base2-44", variantId: FIRST_EDITION_VARIANT },
			1,
		);
		persist("v1|pick-1|0", JUNGLE_TITLE);
		expect((await queue()).listings.some((item) => item.listing.itemId === "v1|pick-1|0")).toBe(
			true,
		);

		const picked = await app().request(queueVariantPath("v1|pick-1|0"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				aliasId: ALIAS_ID,
				phrase: JUNGLE_TITLE,
				variantId: SHARED_VARIANT,
			}),
		});
		expect(picked.status).toBe(200);
		const body = (await picked.json()) as QueueResolutionDocument;
		expect(body.queueState).toBe("resolved");
		expect(body.alias?.variantId).toBe(SHARED_VARIANT);
		expect(body.alias?.cardKey).toBe("en:base2-44");
		expect(body.copy).toBeNull();

		persist("v1|pick-2|0", JUNGLE_TITLE);
		const second = await listingOf("v1|pick-2|0");
		expect(second.queueState).toBe("auto_matched");
		expect(second.match.grain).toBe("variant");
		expect(second.match.cardKey).toBe("en:base2-44");
		expect(second.match.variantId).toBe(SHARED_VARIANT);
		expect((await queue()).listings.map((item) => item.listing.itemId)).not.toContain(
			"v1|pick-2|0",
		);
	});

	it("lets owner confirmation write a copy and never lets the matcher-only path do so", async () => {
		const before = temp.handle.db.select().from(copies).all();
		persist("v1|match-only|0", JUNGLE_TITLE);
		await app().request(listingPath("v1|match-only|0"));
		await app().request(QUEUE_PATH);
		expect(temp.handle.db.select().from(copies).all()).toEqual(before);

		persist("v1|own|0", JAPANESE_PHRASE);
		const recorded = await app().request(queueConfirmPath("v1|own|0"), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				aliasId: ALIAS_ID,
				phrase: JAPANESE_PHRASE,
				cardKey: "ja:SV3-002",
				variantId: "generated",
				recordCopy: { id: COPY_ID },
			}),
		});
		expect(recorded.status).toBe(200);
		const body = (await recorded.json()) as QueueResolutionDocument;
		expect(body.copy?.id).toBe(COPY_ID);
		expect(body.copy?.cardKey).toBe("ja:SV3-002");
		expect(body.copy?.variantId).toBe("generated");
		expect(body.copy?.status).toBe("owned");

		const after = temp.handle.db.select().from(copies).all();
		expect(after).toHaveLength(1);
		expect(after[0]?.id).toBe(COPY_ID);
	});

	it("lets the owner edit and delete an alias", async () => {
		const created = await app().request(ALIASES_PATH, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: ALIAS_ID,
				phrase: "swamp flower",
				cardKey: "ja:SV3-002",
			}),
		});
		expect(created.status).toBe(201);

		const patched = await app().request(aliasPath(ALIAS_ID), {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ phrase: "沼の花" }),
		});
		expect(patched.status).toBe(200);
		expect(((await patched.json()) as AliasDocument).phrase).toBe("沼の花");

		const replay = await app().request(ALIASES_PATH, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: ALIAS_TWO,
				phrase: "沼の花",
				cardKey: "en:base2-44",
			}),
		});
		expect(replay.status).toBe(409);

		const deleted = await app().request(aliasPath(ALIAS_ID), { method: "DELETE" });
		expect(deleted.status).toBe(204);
		const remaining = (await (await app().request(ALIASES_PATH)).json()) as AliasListDocument;
		expect(remaining.aliases).toEqual([]);
	});

	it("surfaces queue depth on the health document", async () => {
		const empty = (await (await app().request(HEALTH_PATH)).json()) as HealthDocument;
		expect(empty.confirmQueueDepth).toBe(0);

		persist("v1|depth|0", JAPANESE_PHRASE);
		const waiting = (await (await app().request(HEALTH_PATH)).json()) as HealthDocument;
		expect(waiting.confirmQueueDepth).toBe(1);
	});
});
