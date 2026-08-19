import { describe, expect, it } from "vitest";
import {
	assertLanguagesUsable,
	buildImageUrl,
	HttpTcgdexClient,
	type ImageManifest,
	lookupImageHash,
	manualCardKey,
	manualVariantId,
	parseImageLocation,
	parseLanguagesFromError,
} from "../server/corpus/tcgdex.ts";

describe("the language list", () => {
	it("is derived from upstream rather than hard-coded", () => {
		// Verbatim from a live 404 body. The documented list omits `es-mx`, which carries six
		// Oddish-line cards — so a hard-coded list taken from the documentation would already be
		// wrong, which is exactly why the spec says to derive it.
		const details =
			"You must use one of the following languages (en, fr, es, es-mx, it, pt, pt-br, " +
			'pt-pt, de, nl, pl, ru, ja, ko, zh-tw, id, th, zh-cn) while you used "zzz"';
		const languages = parseLanguagesFromError(details);
		expect(languages).toHaveLength(18);
		expect(languages).toContain("es-mx");
		expect(languages).toContain("zh-tw");
		expect(languages[0]).toBe("en");
	});

	it("mints hand-added identities in the reserved namespace", () => {
		expect(manualCardKey("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe(
			"manual:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		);
		expect(manualVariantId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBe(
			"manual:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		);
	});

	it("refuses a list that would collide with the hand-added namespace", () => {
		// Hand-added identities live at `manual:{uuid}`. If upstream ever mints a language called
		// `manual`, months of curation are silently overwritten on the next sync.
		expect(() => assertLanguagesUsable(["en", "manual"])).toThrow(/reserved namespace/);
		expect(() => assertLanguagesUsable([])).toThrow(/empty/);
		expect(() => assertLanguagesUsable(["en", "ja"])).not.toThrow();
	});

	it("reads it off the wire without a hard-coded list", async () => {
		const client = new HttpTcgdexClient({
			apiBase: "https://example.invalid/v2",
			fetch: async () =>
				new Response(
					JSON.stringify({
						status: 404,
						details: 'You must use one of the following languages (en, ja) while you used "x"',
					}),
					{ status: 404, headers: { "content-type": "application/json" } },
				),
		});
		expect(await client.listLanguages()).toEqual(["en", "ja"]);
	});
});

describe("image URLs", () => {
	it("appends the quality and extension to upstream's own base, case intact", () => {
		// Verified live: `/EN/…`, `/…/BASE2/…` and `/…/HIGH.webp` all 404 while the exact casing
		// upstream published returns the image. Reassembling the path from our own columns would
		// have to guess `SV3` versus `sv3` and `zh-tw` versus `zh-TW`; appending does not.
		expect(buildImageUrl("https://assets.tcgdex.net/en/base/base2/44")).toBe(
			"https://assets.tcgdex.net/en/base/base2/44/high.webp",
		);
		expect(buildImageUrl("https://assets.tcgdex.net/ja/sv/SV3/002")).toBe(
			"https://assets.tcgdex.net/ja/sv/SV3/002/high.webp",
		);
		expect(buildImageUrl("https://assets.tcgdex.net/zh-tw/sv/SV4a/191/")).toBe(
			"https://assets.tcgdex.net/zh-tw/sv/SV4a/191/high.webp",
		);
	});

	it("never changes the case of a segment it was given", () => {
		const url = buildImageUrl("https://assets.tcgdex.net/zh-tw/sm/SM11b/001");
		expect(url).toContain("/zh-tw/");
		expect(url).toContain("/SM11b/");
		expect(url.endsWith("/high.webp")).toBe(true);
	});
});

describe("the datas.json hash manifest", () => {
	const manifest: ImageManifest = {
		en: { base: { base2: { "44": "137336fea0d5652349c4c46988631ae74ff2adcb" } } },
		ja: { sv: { SV3: { "002": "aaaa" } } },
	};

	it("is keyed by the set nesting, so the coordinates come off the image URL", () => {
		// `language → series → set → localId → hash`, not by full card ID. Nothing in the card
		// payload names the series; the image URL's four segments are where it lives.
		const at = parseImageLocation("https://assets.tcgdex.net/en/base/base2/44");
		expect(at).toEqual({ language: "en", series: "base", set: "base2", localId: "44" });
		expect(at === null ? null : lookupImageHash(manifest, at)).toBe(
			"137336fea0d5652349c4c46988631ae74ff2adcb",
		);
	});

	it("matches case-sensitively in every segment", () => {
		const wrong = parseImageLocation("https://assets.tcgdex.net/ja/sv/sv3/002");
		expect(wrong === null ? null : lookupImageHash(manifest, wrong)).toBeNull();
		const right = parseImageLocation("https://assets.tcgdex.net/ja/sv/SV3/002");
		expect(right === null ? null : lookupImageHash(manifest, right)).toBe("aaaa");
	});

	it("rejects a URL that is not four segments", () => {
		expect(parseImageLocation("https://assets.tcgdex.net/en/base/base2")).toBeNull();
		expect(parseImageLocation("not a url")).toBeNull();
	});

	it("revalidates with an ETag and reports a 304 rather than re-downloading 6.4 MB", async () => {
		const seen: (string | undefined)[] = [];
		const client = new HttpTcgdexClient({
			manifestUrl: "https://assets.invalid/datas.json",
			fetch: async (_input, init) => {
				const headers = new Headers(init?.headers);
				seen.push(headers.get("if-none-match") ?? undefined);
				return new Response(null, { status: 304 });
			},
		});
		const result = await client.fetchImageManifest('"abc"');
		expect(seen).toEqual(['"abc"']);
		expect(result.notModified).toBe(true);
		expect(result.manifest).toBeNull();
		expect(result.etag).toBe('"abc"');
	});
});

describe("retry", () => {
	it("backs off and retries a 429 rather than failing the sync", async () => {
		let calls = 0;
		const client = new HttpTcgdexClient({
			apiBase: "https://example.invalid/v2",
			backoffMs: 0,
			sleep: async () => {},
			fetch: async () => {
				calls++;
				return calls < 3
					? new Response("slow down", { status: 429 })
					: new Response(JSON.stringify([{ id: "base2-44", localId: "44", name: "Gloom" }]), {
							status: 200,
							headers: { "content-type": "application/json" },
						});
			},
		});
		const cards = await client.listCards("en");
		expect(calls).toBe(3);
		expect(cards.map((c) => c.id)).toEqual(["base2-44"]);
	});

	it("gives up after the configured attempts", async () => {
		const client = new HttpTcgdexClient({
			apiBase: "https://example.invalid/v2",
			attempts: 2,
			backoffMs: 0,
			sleep: async () => {},
			fetch: async () => new Response("boom", { status: 503 }),
		});
		await expect(client.listCards("en")).rejects.toThrow(/503/);
	});

	it("uses `eq:` on the dex filter, because the default filter is a contains match", async () => {
		// A bare `dexId=43` returns 403 English cards where 32 are wanted: the laxist filter
		// matches 431 as containing 43.
		const urls: string[] = [];
		const client = new HttpTcgdexClient({
			apiBase: "https://example.invalid/v2",
			fetch: async (input) => {
				urls.push(String(input));
				return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
			},
		});
		await client.listCardsByDexId("en", 43);
		expect(urls[0]).toBe("https://example.invalid/v2/en/cards?dexId=eq:43");
	});
});
