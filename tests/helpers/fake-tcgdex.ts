import type {
	FetchedImage,
	ImageManifest,
	ManifestFetchResult,
	TcgdexCardBrief,
	TcgdexCardDetail,
	TcgdexClient,
	TcgdexSetDetail,
} from "../../server/corpus/tcgdex.ts";

/**
 * A TCGdex faked at its own boundary, so the sync can be driven end to end against a real
 * database without touching the network. It records what was asked for, which is how the tests
 * assert that phase 2 fetched detail only for survivors.
 */
export interface FakeCorpus {
	languages: string[];
	/** language → brief records. */
	cards: Record<string, TcgdexCardBrief[]>;
	/** language → cardId → dex ids. */
	dexIds: Record<string, Record<string, number[]>>;
	/** `{language}|{cardId}` → detail. */
	details: Record<string, TcgdexCardDetail>;
	/** `{language}|{setId}` → set detail. Absent means upstream 404s for that set. */
	sets: Record<string, TcgdexSetDetail>;
	manifest: ImageManifest;
	manifestEtag: string;
	/** Image URL → bytes. Absent means upstream 404s. */
	images: Record<string, Uint8Array>;
}

export class FakeTcgdexClient implements TcgdexClient {
	readonly detailRequests: string[] = [];
	readonly setRequests: string[] = [];
	readonly imageRequests: string[] = [];
	manifestRequests = 0;
	/** Set to make the named language's brief fetch fail, as an upstream outage would. */
	failBriefFor: Set<string> = new Set();
	/** `{language}|{setId}` entries whose set fetch should throw, as a transport failure would. */
	failSetFor: Set<string> = new Set();

	constructor(private readonly corpus: FakeCorpus) {}

	async listLanguages(): Promise<string[]> {
		return [...this.corpus.languages];
	}

	async listCards(language: string): Promise<TcgdexCardBrief[]> {
		if (this.failBriefFor.has(language)) throw new Error(`upstream is down for ${language}`);
		return [...(this.corpus.cards[language] ?? [])];
	}

	async listCardsByDexId(language: string, dexId: number): Promise<TcgdexCardBrief[]> {
		if (this.failBriefFor.has(language)) throw new Error(`upstream is down for ${language}`);
		const index = this.corpus.dexIds[language] ?? {};
		const wanted = new Set(
			Object.entries(index)
				.filter(([, ids]) => ids.includes(dexId))
				.map(([cardId]) => cardId),
		);
		return (this.corpus.cards[language] ?? []).filter((card) => wanted.has(card.id));
	}

	async getCard(language: string, cardId: string): Promise<TcgdexCardDetail | null> {
		this.detailRequests.push(`${language}|${cardId}`);
		return this.corpus.details[`${language}|${cardId}`] ?? null;
	}

	async getSet(language: string, setId: string): Promise<TcgdexSetDetail | null> {
		const key = `${language}|${setId}`;
		this.setRequests.push(key);
		if (this.failSetFor.has(key)) throw new Error(`upstream is down for set ${key}`);
		return this.corpus.sets[key] ?? null;
	}

	async fetchImageManifest(etag: string | null): Promise<ManifestFetchResult> {
		this.manifestRequests++;
		if (etag === this.corpus.manifestEtag) {
			return { manifest: null, etag, notModified: true };
		}
		return { manifest: this.corpus.manifest, etag: this.corpus.manifestEtag, notModified: false };
	}

	async fetchImage(url: string): Promise<FetchedImage | null> {
		this.imageRequests.push(url);
		const bytes = this.corpus.images[url];
		return bytes === undefined ? null : { bytes, contentType: "image/webp" };
	}
}

/** A tiny but real webp header, so a stored BLOB is recognisably an image and not a string. */
export function webpBytes(seed: number): Uint8Array {
	const bytes = new Uint8Array(16);
	bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
	bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
	bytes[15] = seed & 0xff;
	return bytes;
}
