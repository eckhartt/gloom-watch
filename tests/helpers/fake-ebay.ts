import { PRODUCTION_API_ROOT } from "../../server/ebay/credentials.ts";
import { CLIENT_CREDENTIALS_SCOPE, type FetchFn } from "../../server/ebay/oauth.ts";
import type { EbayItemSummary } from "../../server/ebay/whitelist.ts";

/**
 * An eBay HTTP boundary the scanner can be driven against without touching the network.
 *
 * The client is faked at `fetch`, not at a higher seam: cursor arithmetic, paging, 401 remint
 * and 429 backoff all live below that line and have to actually run.
 */

export const FIXTURE_SELLER = "unique-fixture-seller-xyz-1842";
export const FIXTURE_SALT = "test-relist-hash-salt";

export function fixtureSummary(
	overrides: Partial<EbayItemSummary> & { readonly itemId: string },
): EbayItemSummary {
	return {
		title: "Gloom Jungle 44/64",
		price: { value: "12.99", currency: "USD" },
		seller: { username: FIXTURE_SELLER, feedbackPercentage: "99.8", feedbackScore: 1200 },
		condition: "Very Good",
		conditionId: 4000,
		itemWebUrl: `https://www.ebay.com/itm/${overrides.itemId}`,
		itemLocation: { country: "US" },
		buyingOptions: ["FIXED_PRICE"],
		itemOriginDate: "2026-08-18T00:00:00.000Z",
		...overrides,
	};
}

export interface RecordedRequest {
	readonly url: string;
	readonly method: string;
	readonly authorization: string | null;
	readonly marketplace: string | null;
}

export interface FakeEbayOptions {
	readonly accessToken?: string;
	readonly tokenStatus?: number;
}

interface SearchHandler {
	readonly match: (url: URL) => boolean;
	readonly respond: (url: URL, request: Request) => Response | Promise<Response>;
}

export class FakeEbayFetch {
	readonly requests: RecordedRequest[] = [];
	readonly sleeps: number[] = [];
	accessToken: string;
	tokenStatus: number;
	/** How many times the token endpoint has been hit. */
	tokenMints = 0;
	/** Search URLs that should 401 once, then succeed. */
	unauthorizedOnce = new Set<string>();
	/** Remaining 429s to emit before succeeding. */
	tooManyTimes = 0;
	retryAfterSeconds = 0;
	/** Marketplace header values (`EBAY_GB`) that should 500. */
	failMarketplaces = new Set<string>();

	private readonly searchHandlers: SearchHandler[] = [];
	private defaultSummaries: EbayItemSummary[] = [];

	constructor(options: FakeEbayOptions = {}) {
		this.accessToken = options.accessToken ?? "fixture-access-token";
		this.tokenStatus = options.tokenStatus ?? 200;
	}

	/** Pages returned for any search that no more-specific handler claims. */
	setDefaultSummaries(summaries: EbayItemSummary[]): void {
		this.defaultSummaries = summaries;
	}

	onSearch(match: (url: URL) => boolean, respond: SearchHandler["respond"]): void {
		this.searchHandlers.push({ match, respond });
	}

	/** A two-page keyword search: first page carries `next`, second is the last. */
	pageTwice(first: EbayItemSummary[], second: EbayItemSummary[]): void {
		let page = 0;
		this.onSearch(
			(url) => url.pathname.endsWith("/item_summary/search"),
			() => {
				page += 1;
				if (page === 1) {
					return jsonResponse({
						itemSummaries: first,
						next: `${PRODUCTION_API_ROOT}/buy/browse/v1/item_summary/search?offset=200`,
						total: first.length + second.length,
					});
				}
				return jsonResponse({ itemSummaries: second, total: first.length + second.length });
			},
		);
	}

	sleep: (ms: number) => Promise<void> = async (ms) => {
		this.sleeps.push(ms);
	};

	fetch: FetchFn = async (input, init) => {
		const url = new URL(String(input));
		const method = (init?.method ?? "GET").toUpperCase();
		const headers = new Headers(init?.headers);
		this.requests.push({
			url: url.toString(),
			method,
			authorization: headers.get("authorization"),
			marketplace: headers.get("x-ebay-c-marketplace-id"),
		});

		if (url.pathname.endsWith("/oauth2/token")) {
			this.tokenMints += 1;
			if (this.tokenStatus !== 200) {
				return new Response("denied", { status: this.tokenStatus });
			}
			const body = typeof init?.body === "string" ? init.body : "";
			if (!body.includes("grant_type=client_credentials")) {
				return new Response("bad grant", { status: 400 });
			}
			if (!body.includes(encodeURIComponent(CLIENT_CREDENTIALS_SCOPE))) {
				return new Response("bad scope", { status: 400 });
			}
			return jsonResponse({
				access_token: this.accessToken,
				expires_in: 7200,
				token_type: "Application Access Token",
			});
		}

		if (url.pathname.endsWith("/get_default_category_tree_id")) {
			return jsonResponse({ categoryTreeId: "3" });
		}

		if (url.pathname.includes("/get_category_suggestions")) {
			return jsonResponse({
				categorySuggestions: [
					{ category: { categoryId: "183455", categoryName: "CCG Individual Cards" } },
				],
			});
		}

		if (url.pathname.endsWith("/item_summary/search")) {
			const marketplace = headers.get("x-ebay-c-marketplace-id");
			if (marketplace !== null && this.failMarketplaces.has(marketplace)) {
				return new Response("upstream exploded", { status: 500 });
			}
			const key = url.toString();
			if (this.unauthorizedOnce.has(key) || this.unauthorizedOnce.has(url.pathname)) {
				this.unauthorizedOnce.delete(key);
				this.unauthorizedOnce.delete(url.pathname);
				return new Response("token expired", { status: 401 });
			}
			if (this.tooManyTimes > 0) {
				this.tooManyTimes -= 1;
				return new Response("slow down", {
					status: 429,
					headers: { "retry-after": String(this.retryAfterSeconds) },
				});
			}

			for (const handler of this.searchHandlers) {
				if (handler.match(url)) {
					return handler.respond(url, new Request(url.toString(), init));
				}
			}

			return jsonResponse({
				itemSummaries: this.defaultSummaries,
				total: this.defaultSummaries.length,
			});
		}

		return new Response(`unexpected ${method} ${url.pathname}`, { status: 404 });
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}
