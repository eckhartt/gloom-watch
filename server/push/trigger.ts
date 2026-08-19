/**
 * Drive the existing web-push sender from a listing the matcher has already resolved.
 *
 * This is the judgement layer, not a second transport. Encryption, VAPID, the echo log and the
 * payload shapes stay in `send.ts`. A filtered listing stays in the feed; this function simply
 * does not notify.
 */

import { binderEntryKey } from "../../shared/contract.ts";
import type { ListingDocument } from "../../shared/listings.ts";
import type { PushNotificationContent } from "../../shared/push.ts";
import {
	buildInstantPushContent,
	decidePushDisposition,
	instantPushSubject,
	type PushDisposition,
} from "../../shared/push-policy.ts";
import { readOwnedCopyCounts } from "../binder/ownership.ts";
import { readVariantPriorities } from "../copies/repository.ts";
import type { GloomDatabase } from "../db/client.ts";
import { loadMatcherCorpus } from "../matcher/corpus.ts";
import { type PushSendOutcome, sendPushToEverySubscription } from "./send.ts";
import type { VapidConfig } from "./vapid.ts";

export interface TriggerInstantPushDeps {
	readonly db: GloomDatabase;
	readonly vapid: VapidConfig;
	readonly publicOrigin: string;
	readonly now?: () => number;
	readonly fetch?: typeof globalThis.fetch;
}

export interface TriggerInstantPushResult {
	readonly disposition: PushDisposition;
	readonly outcomes: readonly PushSendOutcome[];
	readonly content: PushNotificationContent | null;
}

function collectionState(db: GloomDatabase): {
	readonly owned: ReadonlySet<string>;
	readonly priorities: ReadonlyMap<string, number>;
} {
	return {
		owned: new Set(readOwnedCopyCounts(db).keys()),
		priorities: new Map(
			readVariantPriorities(db).map((row) => [
				binderEntryKey(row.cardKey, row.variantId),
				row.priority,
			]),
		),
	};
}

/**
 * Decide whether this listing earns an instant push, and send one if it does.
 *
 * Digest is a later ticket: a `digest` disposition is recorded and nothing is sent. Do not
 * treat that as "the policy said nothing" — the card is wanted, just not loudly.
 */
export async function triggerInstantPush(
	deps: TriggerInstantPushDeps,
	listing: ListingDocument,
): Promise<TriggerInstantPushResult> {
	const state = collectionState(deps.db);
	const disposition = decidePushDisposition({
		match: listing.match,
		owned: state.owned,
		priorities: state.priorities,
	});

	if (disposition !== "instant") {
		return { disposition, outcomes: [], content: null };
	}

	const cardKey = listing.match.cardKey;
	const card =
		cardKey === null
			? null
			: (loadMatcherCorpus(deps.db).cards.find((entry) => entry.cardKey === cardKey) ?? null);
	const subject = instantPushSubject(listing, card);
	if (subject === null) {
		return { disposition: "nothing", outcomes: [], content: null };
	}

	const content = buildInstantPushContent(subject, deps.publicOrigin);
	const outcomes = await sendPushToEverySubscription(
		{
			db: deps.db,
			vapid: deps.vapid,
			...(deps.now === undefined ? {} : { now: deps.now }),
			...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
		},
		{ content, kind: "instant" },
	);
	return { disposition, outcomes, content };
}
