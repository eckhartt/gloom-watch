/**
 * Observed eBay listings — the wire vocabulary and the tunables the scanner starts from.
 *
 * A listing is raw observed data, not a claim about the collection. Resolving one to a card is
 * a later ticket. This module is what both sides share so the feed cannot display a field the
 * server never meant to send — most importantly `seller_hash`, which exists only as a relist
 * key and is never on the wire.
 *
 * **Time.** Stored instants are UTC epoch milliseconds. The six-hour display rule and the
 * ninety-day retention are both measured from `observed_at`, not from eBay's `itemOriginDate`.
 */

/** The four marketplaces v1 scans. Japan is out — it is a cross-border export business. */
export const MARKETPLACES = ["US", "GB", "DE", "AU"] as const;
export type Marketplace = (typeof MARKETPLACES)[number];

/** eBay's `X-EBAY-C-MARKETPLACE-ID` header value for each of those. */
export const EBAY_MARKETPLACE_IDS: Readonly<Record<Marketplace, string>> = {
	US: "EBAY_US",
	GB: "EBAY_GB",
	DE: "EBAY_DE",
	AU: "EBAY_AU",
};

/**
 * How often each marketplace is visited, in scan cycles.
 *
 * US and GB every cycle; DE and AU every fourth. A single global cursor would lose most of
 * DE and AU's listings on the cycles they are skipped — that is why cursors are per-marketplace,
 * and why a US-only cycle must not touch the other two.
 */
export const MARKETPLACE_EVERY_N: Readonly<Record<Marketplace, number>> = {
	US: 1,
	GB: 1,
	DE: 4,
	AU: 4,
};

/** Confirmed leaf ID for US CCG Individual Cards. GB/DE/AU are resolved via Taxonomy. */
export const US_CATEGORY_ID = "183454";

/** The four species names. One Browse call per (keyword, marketplace), plus its aspect sibling. */
export const DEFAULT_SCAN_KEYWORDS = ["Oddish", "Gloom", "Vileplume", "Bellossom"] as const;

export const DEFAULT_SCAN_INTERVAL_MINUTES = 10;
export const DEFAULT_SCAN_CURSOR_OVERLAP_MINUTES = 5;
/** Leaves headroom under eBay's 5,000/day application quota. */
export const DEFAULT_DAILY_CALL_BUDGET = 4000;

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
}

export interface ListingsDocument {
	readonly generatedAt: number;
	readonly listings: readonly ListingDocument[];
}

export interface ScanMarketplaceHealth {
	readonly marketplace: Marketplace;
	readonly lastScannedAt: number | null;
	readonly lastSuccessAt: number | null;
	readonly consecutiveFailures: number;
	readonly categoryId: string | null;
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
const DAY_MS = 24 * HOUR_MS;

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
