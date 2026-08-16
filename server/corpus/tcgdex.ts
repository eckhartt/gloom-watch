/**
 * The TCGdex client.
 *
 * Every shape here was read off a live response rather than inferred from the documentation —
 * the documentation's language list is already out of date (it omits `es-mx`, which carries six
 * Oddish-line cards) and the brief card form carries fewer fields than the reference table
 * suggests.
 *
 * The client is injectable so the ingest tests never touch the network; see `TcgdexClient`.
 */

export const TCGDEX_API_BASE = "https://api.tcgdex.net/v2";
export const TCGDEX_ASSETS_BASE = "https://assets.tcgdex.net";

/** The per-card image hash manifest. ~6.4 MB, `language → series → set → localId → hash`. */
export const IMAGE_MANIFEST_URL = `${TCGDEX_ASSETS_BASE}/datas.json`;

/**
 * The brief form. This is everything `/v2/{lang}/cards` returns — note the absence of `dexId`,
 * which is why membership needs a second, narrow request per species; see `membership.ts`.
 */
export interface TcgdexCardBrief {
	readonly id: string;
	readonly localId: string;
	readonly name: string;
	readonly image?: string;
}

/**
 * One entry of `variants_detailed`. Upstream names the finish axis `type` and the stamp axis
 * `stamp` (singular, an array). `pricing` is present on some entries and is deliberately not
 * modelled: market prices are out of scope, and storing them would churn every row on every
 * sync.
 */
export interface TcgdexVariantDetailed {
	readonly variantId: string;
	readonly type?: string;
	readonly subtype?: string;
	readonly stamp?: readonly string[];
	readonly foil?: string;
	readonly size?: string;
}

export interface TcgdexCardDetail {
	readonly id: string;
	readonly localId: string;
	readonly name: string;
	readonly image?: string;
	readonly category?: string;
	readonly rarity?: string;
	readonly illustrator?: string;
	readonly dexId?: readonly number[];
	readonly set: { readonly id: string; readonly name?: string };
	/**
	 * The legacy flat object. Present on every response and **deliberately unused** — it
	 * disagrees with `variants_detailed` (`base1-58` reports one printing here and six there).
	 * Typed only so that reading it is a visible act rather than an accident.
	 */
	readonly variants?: Readonly<Record<string, boolean>>;
	readonly variants_detailed?: readonly TcgdexVariantDetailed[];
}

/** `language → series → set → localId → hash`. Not keyed by full card ID. */
export type ImageManifest = Readonly<
	Record<string, Record<string, Record<string, Record<string, string>>>>
>;

export interface ManifestFetchResult {
	/** `null` when upstream answered 304 — the cached manifest is still current. */
	readonly manifest: ImageManifest | null;
	readonly etag: string | null;
	readonly notModified: boolean;
}

export interface FetchedImage {
	readonly bytes: Uint8Array;
	readonly contentType: string;
}

export interface TcgdexClient {
	/** Every language TCGdex will answer for, derived from upstream rather than hard-coded. */
	listLanguages(): Promise<string[]>;
	/** The whole brief list for a language. Membership filtering then happens locally. */
	listCards(language: string): Promise<TcgdexCardBrief[]>;
	/** The one thing the brief form cannot answer locally: which cards carry a `dexId`. */
	listCardsByDexId(language: string, dexId: number): Promise<TcgdexCardBrief[]>;
	getCard(language: string, cardId: string): Promise<TcgdexCardDetail | null>;
	fetchImageManifest(etag: string | null): Promise<ManifestFetchResult>;
	fetchImage(url: string): Promise<FetchedImage | null>;
}

/**
 * Just the part of `fetch` this client uses. Deliberately narrower than `typeof globalThis
 * .fetch`, which under Bun's types also carries `preconnect` and would make every test stub
 * declare a method it has no use for.
 */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
	readonly apiBase?: string;
	readonly manifestUrl?: string;
	/** Attempts per request, including the first. */
	readonly attempts?: number;
	/** Base delay for the exponential backoff, in milliseconds. */
	readonly backoffMs?: number;
	readonly fetch?: FetchLike;
	readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BACKOFF_MS = 500;

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TcgdexError extends Error {
	readonly status: number | null;

	constructor(message: string, status: number | null) {
		super(message);
		this.name = "TcgdexError";
		this.status = status;
	}
}

/**
 * The language list is **derived on each sync**, so a language gaining its first Oddish-line
 * record is picked up without a code change.
 *
 * TCGdex publishes no endpoint that enumerates languages, but it enumerates them in the 404 it
 * returns for one it does not know — and that payload is generated from the same list the router
 * uses, so it cannot drift from reality. The documented list is already stale by one language;
 * this one is not.
 */
export function parseLanguagesFromError(details: string): string[] {
	const open = details.indexOf("(");
	const close = details.indexOf(")", open);
	if (open === -1 || close === -1) {
		throw new TcgdexError(`could not read the language list from ${JSON.stringify(details)}`, null);
	}
	return details
		.slice(open + 1, close)
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
}

/** A language code TCGdex will never mint, reserved for the owner's hand-added rows. */
export const MANUAL_NAMESPACE = "manual";

export function assertLanguagesUsable(languages: readonly string[]): void {
	if (languages.length === 0) {
		throw new TcgdexError("upstream returned an empty language list", null);
	}
	if (languages.includes(MANUAL_NAMESPACE)) {
		// Hand-added identities live at `manual:{uuid}`. If upstream ever mints a language called
		// `manual` the two namespaces collide and curation is silently overwritten on the next
		// sync, so this fails loudly instead.
		throw new TcgdexError(
			`upstream language list contains the reserved namespace "${MANUAL_NAMESPACE}"`,
			null,
		);
	}
}

export class HttpTcgdexClient implements TcgdexClient {
	private readonly apiBase: string;
	private readonly manifestUrl: string;
	private readonly attempts: number;
	private readonly backoffMs: number;
	private readonly doFetch: FetchLike;
	private readonly sleep: (ms: number) => Promise<void>;

	constructor(options: HttpClientOptions = {}) {
		this.apiBase = options.apiBase ?? TCGDEX_API_BASE;
		this.manifestUrl = options.manifestUrl ?? IMAGE_MANIFEST_URL;
		this.attempts = options.attempts ?? DEFAULT_ATTEMPTS;
		this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
		this.doFetch = options.fetch ?? globalThis.fetch;
		this.sleep = options.sleep ?? defaultSleep;
	}

	/** Retries on a transport error, on 429 and on 5xx. A 4xx other than 429 is returned as-is. */
	private async request(url: string, init?: RequestInit): Promise<Response> {
		let lastError: unknown = null;
		for (let attempt = 0; attempt < this.attempts; attempt++) {
			if (attempt > 0) await this.sleep(this.backoffMs * 2 ** (attempt - 1));
			try {
				const response = await this.doFetch(url, init);
				if (response.status === 429 || response.status >= 500) {
					lastError = new TcgdexError(`GET ${url} responded ${response.status}`, response.status);
					continue;
				}
				return response;
			} catch (error) {
				lastError = error;
			}
		}
		if (lastError instanceof Error) throw lastError;
		throw new TcgdexError(`GET ${url} failed after ${this.attempts} attempts`, null);
	}

	private async getJson(path: string): Promise<unknown> {
		const url = `${this.apiBase}${path}`;
		const response = await this.request(url);
		if (!response.ok) {
			throw new TcgdexError(`GET ${url} responded ${response.status}`, response.status);
		}
		return await response.json();
	}

	async listLanguages(): Promise<string[]> {
		// A deliberately invalid code. The 404 body enumerates the valid ones.
		const url = `${this.apiBase}/__languages__/cards`;
		const response = await this.request(url);
		const body = (await response.json()) as { details?: unknown };
		if (typeof body.details !== "string") {
			throw new TcgdexError(`GET ${url} did not carry a language list`, response.status);
		}
		const languages = parseLanguagesFromError(body.details);
		assertLanguagesUsable(languages);
		return languages;
	}

	async listCards(language: string): Promise<TcgdexCardBrief[]> {
		const body = await this.getJson(`/${encodeURIComponent(language)}/cards`);
		return Array.isArray(body) ? (body as TcgdexCardBrief[]) : [];
	}

	async listCardsByDexId(language: string, dexId: number): Promise<TcgdexCardBrief[]> {
		// `eq:` is not optional. The default filter is a *contains* match, so a bare `dexId=43`
		// also returns every card whose dex list contains 431 — 403 cards where 32 are wanted.
		const body = await this.getJson(`/${encodeURIComponent(language)}/cards?dexId=eq:${dexId}`);
		return Array.isArray(body) ? (body as TcgdexCardBrief[]) : [];
	}

	async getCard(language: string, cardId: string): Promise<TcgdexCardDetail | null> {
		const url = `${this.apiBase}/${encodeURIComponent(language)}/cards/${encodeURIComponent(cardId)}`;
		const response = await this.request(url);
		if (response.status === 404) return null;
		if (!response.ok) {
			throw new TcgdexError(`GET ${url} responded ${response.status}`, response.status);
		}
		return (await response.json()) as TcgdexCardDetail;
	}

	async fetchImageManifest(etag: string | null): Promise<ManifestFetchResult> {
		const headers = etag === null ? undefined : { "if-none-match": etag };
		const response = await this.request(this.manifestUrl, headers ? { headers } : undefined);
		if (response.status === 304) {
			return { manifest: null, etag, notModified: true };
		}
		if (!response.ok) {
			throw new TcgdexError(
				`GET ${this.manifestUrl} responded ${response.status}`,
				response.status,
			);
		}
		return {
			manifest: (await response.json()) as ImageManifest,
			etag: response.headers.get("etag"),
			notModified: false,
		};
	}

	async fetchImage(url: string): Promise<FetchedImage | null> {
		const response = await this.request(url);
		if (response.status === 404) return null;
		if (!response.ok) {
			throw new TcgdexError(`GET ${url} responded ${response.status}`, response.status);
		}
		return {
			bytes: new Uint8Array(await response.arrayBuffer()),
			contentType: response.headers.get("content-type") ?? "image/webp",
		};
	}
}

/** Corpus images are `high.webp`, per the spec. `low` and the png/jpg forms are not stored. */
export const IMAGE_QUALITY = "high";
export const IMAGE_EXTENSION = "webp";
export const IMAGE_CONTENT_TYPE = "image/webp";

/**
 * Build the image URL from the base URL upstream already gave us.
 *
 * **Every path segment is case-sensitive and a wrong one 404s** — verified against the live
 * asset host, where `/EN/…`, `/…/BASE2/…` and `/…/HIGH.webp` all return 404 while the lowercase
 * forms return the image. That is exactly why this appends to the `image` field rather than
 * reassembling `{language}/{series}/{set}/{localId}` from our own columns: upstream's casing is
 * not derivable from ours. Japanese sets are `SV3`, `S9a`, `PMCG2`; the language segment is
 * `zh-tw`, not `zh-TW`; the quality segment is lowercase.
 *
 * The one segment we do own is the quality/extension suffix, and it is a constant.
 */
export function buildImageUrl(imageBase: string): string {
	return `${imageBase.replace(/\/+$/, "")}/${IMAGE_QUALITY}.${IMAGE_EXTENSION}`;
}

export interface ImageLocation {
	readonly language: string;
	readonly series: string;
	readonly set: string;
	readonly localId: string;
}

/**
 * Read the manifest coordinates back out of an image base URL.
 *
 * `datas.json` is keyed by the set nesting rather than by card ID, so the sync has to
 * reconstruct `language → series → set → localId`. The `image` field carries exactly those four
 * segments in exactly the casing the manifest uses, which makes parsing it more reliable than
 * deriving them: our `set_id` column holds `base2`, but nothing in the card payload names the
 * series `base`. Checked against every card in the line: 382 of 382 with an image resolve to a
 * manifest entry, all four segments, language segment always equal to the card's language.
 */
export function parseImageLocation(imageBase: string): ImageLocation | null {
	let path: string;
	try {
		path = new URL(imageBase).pathname;
	} catch {
		return null;
	}
	const segments = path.split("/").filter((segment) => segment !== "");
	if (segments.length !== 4) return null;
	const [language, series, set, localId] = segments;
	if (
		language === undefined ||
		series === undefined ||
		set === undefined ||
		localId === undefined
	) {
		return null;
	}
	return { language, series, set, localId };
}

export function lookupImageHash(manifest: ImageManifest, at: ImageLocation): string | null {
	return manifest[at.language]?.[at.series]?.[at.set]?.[at.localId] ?? null;
}
