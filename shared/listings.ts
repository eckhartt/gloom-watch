/**
 * Observed eBay listings — the wire vocabulary and the tunables the scanner starts from.
 *
 * A listing is raw observed data, not a claim about the collection. The matcher attaches a
 * resolution at read time; this module is what both sides share so the feed cannot display a
 * field the server never meant to send — most importantly `seller_hash`, which exists only
 * as a relist key and is never on the wire.
 *
 * **Time.** Stored instants are UTC epoch milliseconds. The six-hour display rule and the
 * ninety-day retention are both measured from `observed_at`, not from eBay's `itemOriginDate`.
 */

import type { ListingResolution } from "./matcher.ts";

/** The four marketplaces v1 scans. Japan is out — it is a cross-border export business. */
export const MARKETPLACES = ["AU", "US", "GB", "DE"] as const;
export type Marketplace = (typeof MARKETPLACES)[number];

/** eBay's `X-EBAY-C-MARKETPLACE-ID` header value for each of those. */
export const EBAY_MARKETPLACE_IDS: Readonly<Record<Marketplace, string>> = {
	US: "EBAY_US",
	GB: "EBAY_GB",
	DE: "EBAY_DE",
	AU: "EBAY_AU",
};

/**
 * How often each marketplace is visited, in scan cycles. `0` means never.
 *
 * Only AU is scanned. eBay AU already returns cross-border stock (US/CA/GB/JP
 * sellers shipping here). The feed splits *where the item sits* via
 * `itemLocationCountry`, not which site we queried.
 */
export const MARKETPLACE_EVERY_N: Readonly<Record<Marketplace, number>> = {
	AU: 1,
	US: 0,
	GB: 0,
	DE: 0,
};

export const HOME_MARKETPLACE: Marketplace = "AU";
export const HOME_LOCATION_COUNTRY = "AU";

/** Confirmed leaf ID for US CCG Individual Cards. GB/DE/AU are resolved via Taxonomy. */
export const US_CATEGORY_ID = "183454";

/** The four species names. One Browse call per (keyword, marketplace), plus its aspect sibling. */
export const DEFAULT_SCAN_KEYWORDS = ["Oddish", "Gloom", "Vileplume", "Bellossom"] as const;

export const DEFAULT_SCAN_INTERVAL_MINUTES = 10;
export const DEFAULT_SCAN_CURSOR_OVERLAP_MINUTES = 5;
/** Leaves headroom under eBay's 5,000/day application quota. */
export const DEFAULT_DAILY_CALL_BUDGET = 4000;
/**
 * How far back the commissioning sweep reaches. Ten years is the spec's starting
 * point — most active stock is much younger, and a shorter horizon is the knob
 * for a commissioning that cannot spend a full day's Browse budget.
 */
export const DEFAULT_BACKFILL_HORIZON_DAYS = 3650;
/**
 * The first cut of a backwards window, before the paging-cap bisect. A week is
 * large enough that most marketplaces finish a slice in a handful of calls, and
 * small enough that a spent budget leaves a persisted cursor rather than a
 * half-paged 90-day range.
 */
export const DEFAULT_BACKFILL_WINDOW_DAYS = 7;

/** The whole listing row expires. The seen-set does not. */
export const LISTING_RETENTION_DAYS = 90;

/**
 * eBay's display-freshness term: a listing older than six hours is shown without its price,
 * and the age is disclosed. Nothing re-fetches a listing to refresh it.
 */
export const DISPLAY_FRESHNESS_HOURS = 6;

export const SEARCH_PAGE_LIMIT = 200;
/** Browse deep-paging cap. A window that would exceed this is narrowed, never skipped. */
export const DEEP_PAGE_CAP = 10_000;

/**
 * Aspect name used for the sibling request, unioned on `itemId` with the keyword search.
 *
 * "Character" is the Trading Cards aspect that carries the species. A marketplace whose
 * category does not have it answers empty; that is not a failed scan.
 */
export const SCAN_ASPECT_NAME = "Character";

export const LISTINGS_PATH = "/api/listings";

/** `itemId` is `v1|…|0` and has to be path-encoded at both ends. */
export function listingPath(itemId: string): string {
	return `${LISTINGS_PATH}/${encodeURIComponent(itemId)}`;
}

/**
 * The in-app listing view — the notification tap target.
 *
 * Same-origin and inside the manifest scope. Deep-linking to eBay is impossible from a
 * declarative `navigate`. The item id is encoded because eBay's identifiers carry pipes.
 */
export function listingFeedPath(itemId: string): string {
	return `/feed/${encodeURIComponent(itemId)}`;
}

/**
 * One listing as the feed may show it.
 *
 * **No seller hash. No seller username. No raw payload.** Price is omitted once the observation
 * is older than six hours; `priceHidden` is true in that case so the client can disclose the
 * age rather than rendering a blank.
 */
export interface ListingDocument {
	readonly itemId: string;
	readonly marketplace: Marketplace;
	readonly title: string;
	readonly priceMinor: number | null;
	readonly currency: string | null;
	readonly priceHidden: boolean;
	/** A sentence the UI can render as-is: "7 hours old". */
	readonly ageDisclosed: string;
	readonly buyingOption: string | null;
	readonly itemWebUrl: string | null;
	readonly itemLocationCountry: string | null;
	/** UTC epoch ms of eBay's `itemOriginDate`, when the summary carried one. */
	readonly itemOriginDate: number | null;
	/** UTC epoch ms of the observation. "Seen at." */
	readonly observedAt: number;
	/** `now - observedAt`. The age the disclosure is computed from. */
	readonly ageMs: number;
	/** What the matcher made of the title. Computed at read time; never an ownership write. */
	readonly match: ListingResolution;
	/**
	 * Explicit queue membership. Never derived from `match.confidence` at the wire —
	 * `not_a_match` and `unattempted` have to stay distinguishable.
	 */
	readonly queueState: "unattempted" | "auto_matched" | "queued" | "resolved" | "not_a_match";
}

export interface LocationFacet {
	readonly country: string;
	readonly count: number;
}

export interface ListingsDocument {
	readonly generatedAt: number;
	readonly listings: readonly ListingDocument[];
	readonly locations: readonly LocationFacet[];
}

export interface ScanMarketplaceHealth {
	readonly marketplace: Marketplace;
	readonly lastScannedAt: number | null;
	readonly lastSuccessAt: number | null;
	readonly consecutiveFailures: number;
	readonly categoryId: string | null;
	/** UTC epoch ms. Null until this marketplace's backfill has reached its horizon. */
	readonly backfillCompleteAt: number | null;
	readonly backfillStartedAt: number | null;
	readonly backfillHorizonAt: number | null;
	/** Next window's end — everything after this has been swept. Null before the first slice. */
	readonly backfillWindowEnd: number | null;
	readonly backfillItemsUpserted: number;
}

/**
 * Scanner health. Folded into the health document so the status screen can show the
 * worst-served marketplace without a second request.
 */
export interface ScanHealth {
	readonly cycle: number;
	readonly dailyCallsUsed: number;
	readonly dailyCallBudget: number;
	readonly marketplaces: readonly ScanMarketplaceHealth[];
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export const DISPLAY_FRESHNESS_MS = DISPLAY_FRESHNESS_HOURS * HOUR_MS;
export const LISTING_RETENTION_MS = LISTING_RETENTION_DAYS * DAY_MS;

/**
 * The age sentence the six-hour term requires the UI to show.
 *
 * A timestamp alone is not enough — eBay's term is a *disclosure* of how much older the
 * displayed listing is than the eBay site. This is that sentence, computed in one place so the
 * feed and the detail route cannot disagree.
 */
export function discloseAge(ageMs: number): string {
	if (ageMs < MINUTE_MS) return "less than a minute old";
	if (ageMs < HOUR_MS) {
		const minutes = Math.floor(ageMs / MINUTE_MS);
		return `${minutes} minute${minutes === 1 ? "" : "s"} old`;
	}
	if (ageMs < 2 * DAY_MS) {
		const hours = Math.floor(ageMs / HOUR_MS);
		return `${hours} hour${hours === 1 ? "" : "s"} old`;
	}
	const days = Math.floor(ageMs / DAY_MS);
	return `${days} day${days === 1 ? "" : "s"} old`;
}
