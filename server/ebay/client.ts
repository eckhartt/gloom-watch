import {
	DEEP_PAGE_CAP,
	EBAY_MARKETPLACE_IDS,
	type Marketplace,
	SCAN_ASPECT_NAME,
	SEARCH_PAGE_LIMIT,
	US_CATEGORY_ID,
} from "../../shared/listings.ts";
import type { EbayCredentials } from "./credentials.ts";
import { EbayTokenStore, type FetchFn } from "./oauth.ts";
import { type EbayItemSummary, type ObservedListing, whitelistItem } from "./whitelist.ts";

/**
 * The Browse API client, faked at the HTTP boundary.
 *
 * Every outbound call goes through the injected `fetch`. Tests record fixtures here; nothing
 * in the scanner constructs a URL or reads a seller field. The whitelist runs on the way in,
 * so a caller of `search` never holds a raw `ItemSummary`.
 */

export const BROWSE_SEARCH_PATH = "/buy/browse/v1/item_summary/search";
export const TAXONOMY_TREE_PATH = "/commerce/taxonomy/v1/get_default_category_tree_id";
export const TAXONOMY_SUGGEST_PATH = "/commerce/taxonomy/v1/category_tree";

/** "CCG Individual Cards" is the US leaf's name; Taxonomy suggestions use it for the others. */
export const CATEGORY_SUGGESTION_QUERY = "CCG Individual Cards";

export type SleepFn = (ms: number) => Promise<void>;

export class EbayHttpError extends Error {
	readonly status: number;
	readonly retryAfterMs: number | null;
	readonly calls: number;

	constructor(status: number, detail: string, retryAfterMs: number | null = null, calls = 0) {
		super(`eBay HTTP ${status}: ${detail}`);
		this.name = "EbayHttpError";
		this.status = status;
		this.retryAfterMs = retryAfterMs;
		this.calls = calls;
	}
}

export interface SearchPage {
	readonly items: readonly ObservedListing[];
	readonly next: string | null;
	readonly total: number;
	/** HTTP requests this call actually made, including 401 remints and 429 retries. */
	readonly calls: number;
}

export interface SearchQuery {
	readonly marketplace: Marketplace;
	readonly categoryId: string;
	readonly keyword?: string;
	readonly aspectValue?: string;
	/** UTC epoch ms. Inclusive start of `itemStartDate`. */
	readonly from: number;
	/** UTC epoch ms. Inclusive end; omit for an open window to now. */
	readonly to?: number;
	/** Follow this instead of building a URL — eBay's own `next` href. */
	readonly next?: string;
}

function formatEbayInstant(epochMs: number): string {
	return new Date(epochMs).toISOString();
}

/**
 * The `itemStartDate` filter. **Do not copy eBay's own examples verbatim** — their
 * partial-range examples say `itemEndDate` where they mean `itemStartDate`.
 *
 * This filter keys off `itemOriginDate`, as does `sort=newlyListed`.
 */
export function itemStartDateFilter(from: number, to?: number): string {
	const start = formatEbayInstant(from);
	if (to === undefined) return `itemStartDate:[${start}..]`;
	return `itemStartDate:[${start}..${formatEbayInstant(to)}]`;
}

function parseRetryAfter(header: string | null): number {
	if (header === null || header === "") return 1_000;
	const seconds = Number.parseInt(header, 10);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
	const when = Date.parse(header);
	if (Number.isFinite(when)) return Math.max(0, when - Date.now());
	return 1_000;
}

function isAspectRejected(status: number, body: string): boolean {
	if (status !== 400) return false;
	return /aspect/i.test(body);
}

export class EbayClient {
	private readonly tokens: EbayTokenStore;
	private readonly maxRetries: number;

	constructor(
		private readonly credentials: EbayCredentials,
		private readonly fetchFn: FetchFn,
		private readonly sleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		options: { readonly maxRetries?: number } = {},
	) {
		this.tokens = new EbayTokenStore(credentials, fetchFn);
		this.maxRetries = options.maxRetries ?? 3;
	}

	get salt(): string {
		return this.credentials.relistHashSalt;
	}

	/**
	 * One page of whitelisted listings. Follows 401 by reminting once; follows 429 with
	 * backoff. A 400 that names an aspect is returned as an empty page — the sibling filter
	 * is unavailable on that marketplace, not a failed scan.
	 */
	async search(query: SearchQuery): Promise<SearchPage> {
		const url = query.next ?? this.buildSearchUrl(query);
		const result = await this.authorizedGet(url, query.marketplace, { allowAspectMiss: true });
		if (result.response === null) {
			return { items: [], next: null, total: 0, calls: result.calls };
		}

		const body = (await result.response.json()) as {
			itemSummaries?: EbayItemSummary[];
			next?: string;
			total?: number;
		};

		const items: ObservedListing[] = [];
		for (const raw of body.itemSummaries ?? []) {
			const observed = whitelistItem(raw, this.credentials.relistHashSalt);
			if (observed !== null) items.push(observed);
		}

		return {
			items,
			next: body.next ?? null,
			total: typeof body.total === "number" ? body.total : items.length,
			calls: result.calls,
		};
	}

	/**
	 * Resolve the CCG Individual Cards leaf for a marketplace.
	 *
	 * US is confirmed as `183454` and is never asked about. The others go through Taxonomy
	 * suggestions; a miss returns `null` rather than a guessed id.
	 */
	async resolveCategoryId(
		marketplace: Marketplace,
	): Promise<{ readonly categoryId: string | null; readonly calls: number }> {
		if (marketplace === "US") return { categoryId: US_CATEGORY_ID, calls: 0 };

		const marketplaceId = EBAY_MARKETPLACE_IDS[marketplace];
		const treeUrl = `${this.credentials.apiRoot}${TAXONOMY_TREE_PATH}?marketplace_id=${marketplaceId}`;
		const treeResult = await this.authorizedGet(treeUrl, marketplace);
		if (treeResult.response === null) return { categoryId: null, calls: treeResult.calls };
		const tree = (await treeResult.response.json()) as { categoryTreeId?: string };
		if (tree.categoryTreeId === undefined) {
			return { categoryId: null, calls: treeResult.calls };
		}

		const suggestUrl =
			`${this.credentials.apiRoot}${TAXONOMY_SUGGEST_PATH}/${encodeURIComponent(tree.categoryTreeId)}` +
			`/get_category_suggestions?q=${encodeURIComponent(CATEGORY_SUGGESTION_QUERY)}`;
		const suggestResult = await this.authorizedGet(suggestUrl, marketplace);
		const calls = treeResult.calls + suggestResult.calls;
		if (suggestResult.response === null) return { categoryId: null, calls };
		const suggestions = (await suggestResult.response.json()) as {
			categorySuggestions?: readonly {
				category?: { categoryId?: string; categoryName?: string };
			}[];
		};

		const exact = (suggestions.categorySuggestions ?? []).find(
			(entry) => entry.category?.categoryName === CATEGORY_SUGGESTION_QUERY,
		);
		const fallback = suggestions.categorySuggestions?.[0];
		return {
			categoryId: exact?.category?.categoryId ?? fallback?.category?.categoryId ?? null,
			calls,
		};
	}

	private buildSearchUrl(query: SearchQuery): string {
		const params = new URLSearchParams();
		params.set("category_ids", query.categoryId);
		params.set("sort", "newlyListed");
		params.set("limit", String(SEARCH_PAGE_LIMIT));
		params.set("filter", itemStartDateFilter(query.from, query.to));

		if (query.keyword !== undefined) {
			params.set("q", query.keyword);
		}
		if (query.aspectValue !== undefined) {
			params.set(
				"aspect_filter",
				`categoryId:${query.categoryId},${SCAN_ASPECT_NAME}:{${query.aspectValue}}`,
			);
		}

		return `${this.credentials.apiRoot}${BROWSE_SEARCH_PATH}?${params.toString()}`;
	}

	private async authorizedGet(
		url: string,
		marketplace: Marketplace,
		options: { readonly allowAspectMiss?: boolean } = {},
	): Promise<{ readonly response: Response | null; readonly calls: number }> {
		let retriedAuth = false;
		let attempt = 0;
		let calls = 0;

		while (true) {
			const token = await this.tokens.bearer();
			const response = await this.fetchFn(url, {
				method: "GET",
				headers: {
					authorization: `Bearer ${token}`,
					"x-ebay-c-marketplace-id": EBAY_MARKETPLACE_IDS[marketplace],
					accept: "application/json",
				},
			});
			calls += 1;

			if (response.status === 401 && !retriedAuth) {
				this.tokens.invalidate();
				retriedAuth = true;
				continue;
			}

			if (response.status === 429) {
				attempt += 1;
				if (attempt > this.maxRetries) {
					throw new EbayHttpError(
						429,
						"rate limited past the retry budget",
						parseRetryAfter(response.headers.get("retry-after")),
						calls,
					);
				}
				await this.sleep(parseRetryAfter(response.headers.get("retry-after")));
				continue;
			}

			if (
				options.allowAspectMiss &&
				isAspectRejected(response.status, await response.clone().text())
			) {
				return { response: null, calls };
			}

			if (!response.ok) {
				const detail = (await response.text()).slice(0, 200);
				throw new EbayHttpError(response.status, detail, null, calls);
			}

			return { response, calls };
		}
	}
}

export function windowNeedsNarrowing(total: number): boolean {
	return total >= DEEP_PAGE_CAP;
}
