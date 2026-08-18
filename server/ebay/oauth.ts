import type { EbayCredentials } from "./credentials.ts";

/**
 * Application access token via the client-credentials grant.
 *
 * No refresh token, no user consent. The token's documented lifetime is ~two hours and is
 * treated as unverified: this store remints on 401, never on a hard-coded expiry. Caching the
 * current token is only so a 200-page scan does not mint 200 times; the 401 path is the one
 * the spec names.
 */

export const CLIENT_CREDENTIALS_SCOPE = "https://api.ebay.com/oauth/api_scope";

export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class EbayAuthError extends Error {
	readonly status: number;

	constructor(status: number, detail: string) {
		super(`eBay OAuth failed (${status}): ${detail}`);
		this.name = "EbayAuthError";
		this.status = status;
	}
}

export class EbayTokenStore {
	private token: string | null = null;

	constructor(
		private readonly credentials: EbayCredentials,
		private readonly fetchFn: FetchFn,
	) {}

	/** The cached token, or a freshly minted one if this process has not minted yet. */
	async bearer(): Promise<string> {
		if (this.token !== null) return this.token;
		return this.mint();
	}

	/** Drop the cache so the next `bearer()` hits the token endpoint. Called on 401. */
	invalidate(): void {
		this.token = null;
	}

	async mint(): Promise<string> {
		const basic = Buffer.from(
			`${this.credentials.clientId}:${this.credentials.clientSecret}`,
			"utf8",
		).toString("base64");

		const response = await this.fetchFn(`${this.credentials.apiRoot}/identity/v1/oauth2/token`, {
			method: "POST",
			headers: {
				authorization: `Basic ${basic}`,
				"content-type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "client_credentials",
				scope: CLIENT_CREDENTIALS_SCOPE,
			}).toString(),
		});

		if (!response.ok) {
			const detail = (await response.text()).slice(0, 200);
			throw new EbayAuthError(response.status, detail);
		}

		const body = (await response.json()) as { access_token?: string };
		if (body.access_token === undefined || body.access_token === "") {
			throw new EbayAuthError(response.status, "token response had no access_token");
		}

		this.token = body.access_token;
		return this.token;
	}
}
