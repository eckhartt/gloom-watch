import { parseAmountToMinor } from "../../shared/money.ts";
import { hashSellerUsername } from "./seller-hash.ts";

/**
 * A Browse `ItemSummary` as eBay actually sends it — including the seller block this module
 * exists to strip.
 *
 * Typed here, and **only here**, so that reading `seller.username` is a visible act in one
 * file. Nothing downstream of `whitelistItem` holds this shape.
 */
export interface EbayItemSummary {
	readonly itemId?: string;
	readonly title?: string;
	readonly price?: { readonly value?: string; readonly currency?: string };
	readonly seller?: {
		readonly username?: string;
		readonly feedbackPercentage?: string;
		readonly feedbackScore?: number;
	};
	readonly condition?: string;
	readonly conditionId?: string | number;
	readonly itemWebUrl?: string;
	readonly itemLocation?: { readonly country?: string };
	readonly buyingOptions?: readonly string[];
	readonly itemOriginDate?: string;
	readonly localizedAspects?: readonly {
		readonly name?: string;
		readonly value?: string;
	}[];
}

/**
 * The field whitelist. Everything the matcher will later need, and nothing of the seller
 * but a one-way hash.
 */
export interface ObservedListing {
	readonly itemId: string;
	readonly title: string;
	readonly priceMinor: number | null;
	readonly currency: string | null;
	readonly buyingOption: string | null;
	readonly conditionId: number | null;
	readonly itemWebUrl: string | null;
	readonly itemLocationCountry: string | null;
	readonly itemOriginDate: number | null;
	readonly sellerHash: string | null;
	readonly aspects: Readonly<Record<string, string>>;
}

function readConditionId(raw: string | number | undefined): number | null {
	if (raw === undefined) return null;
	const value = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
	return Number.isInteger(value) ? value : null;
}

function readOriginDate(raw: string | undefined): number | null {
	if (raw === undefined || raw === "") return null;
	const ms = Date.parse(raw);
	return Number.isFinite(ms) ? ms : null;
}

function readAspects(raw: EbayItemSummary["localizedAspects"]): Readonly<Record<string, string>> {
	if (raw === undefined) return {};
	const aspects: Record<string, string> = {};
	for (const entry of raw) {
		if (entry.name === undefined || entry.value === undefined) continue;
		aspects[entry.name] = entry.value;
	}
	return aspects;
}

/**
 * Apply the whitelist. The seller object is read only to hash the username and is then
 * discarded; the returned value has no path back to it.
 *
 * Returns `null` when the summary has no `itemId` — without an identity there is nothing
 * the seen-set or the feed can do with it.
 */
export function whitelistItem(raw: EbayItemSummary, salt: string): ObservedListing | null {
	const itemId = raw.itemId;
	if (itemId === undefined || itemId === "") return null;

	const currency = raw.price?.currency?.toUpperCase() ?? null;
	const priceMinor =
		raw.price?.value !== undefined && currency !== null
			? parseAmountToMinor(raw.price.value, currency)
			: null;

	const username = raw.seller?.username;
	const sellerHash =
		username !== undefined && username !== "" ? hashSellerUsername(username, salt) : null;

	return {
		itemId,
		title: raw.title ?? "",
		priceMinor,
		currency: priceMinor === null ? null : currency,
		buyingOption: raw.buyingOptions?.[0] ?? null,
		conditionId: readConditionId(raw.conditionId),
		itemWebUrl: raw.itemWebUrl ?? null,
		itemLocationCountry: raw.itemLocation?.country ?? null,
		itemOriginDate: readOriginDate(raw.itemOriginDate),
		sellerHash,
		aspects: readAspects(raw.localizedAspects),
	};
}
