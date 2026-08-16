import { describe, expect, it } from "vitest";
import { jobSummary } from "../../client/routes/corpus.tsx";
import type { CorpusSyncJobDocument } from "../../shared/contract.ts";

/**
 * The summary line is the only thing most syncs are ever judged by, and a re-sync of an
 * unchanged corpus is the common case — the corpus is refreshed manually and changes rarely.
 * So the reading that matters most is the one where every number that *could* be zero is.
 */
function jobWith(overrides: Partial<CorpusSyncJobDocument>): CorpusSyncJobDocument {
	return {
		id: "job",
		status: "succeeded",
		phase: "done",
		startedAt: 1,
		updatedAt: 2,
		finishedAt: 2,
		processed: 0,
		total: null,
		message: null,
		error: null,
		languagesSynced: [],
		cardsUpserted: 497,
		variantsUpserted: 817,
		cardsFlaggedMissing: 0,
		variantsFlaggedMissing: 0,
		imagesFetched: 0,
		imagesUnchanged: 382,
		imageBytesFetched: 0,
		unknownAxisValues: [],
		...overrides,
	} as CorpusSyncJobDocument;
}

describe("the sync summary line", () => {
	it("reports how many images there are, not how many were downloaded", () => {
		// The regression: `imagesFetched` sat in a list of totals, so a no-op re-sync read
		// "0 image(s)" and was taken to mean the corpus had lost its images.
		const summary = jobSummary(jobWith({ imagesFetched: 0, imagesUnchanged: 382 }));

		expect(summary).toContain("382 image(s)");
		expect(summary).not.toMatch(/\b0 image\(s\)/);
		expect(summary).toContain("none newly fetched");
	});

	it("still distinguishes a first sync, where everything was downloaded", () => {
		const summary = jobSummary(jobWith({ imagesFetched: 382, imagesUnchanged: 0 }));

		expect(summary).toContain("382 image(s)");
		expect(summary).toContain("382 newly fetched");
	});

	it("counts fetched and unchanged together when a sync moved some of each", () => {
		expect(jobSummary(jobWith({ imagesFetched: 7, imagesUnchanged: 375 }))).toContain(
			"382 image(s) — 7 newly fetched",
		);
	});

	it("mentions flagged variants only when there are some, since zero is the normal case", () => {
		expect(jobSummary(jobWith({ variantsFlaggedMissing: 0 }))).not.toContain("flagged missing");
		expect(jobSummary(jobWith({ variantsFlaggedMissing: 3 }))).toContain("3 flagged missing");
	});

	it("says what went wrong rather than reporting counts, when a sync did not succeed", () => {
		expect(jobSummary(jobWith({ status: "failed", error: "TCGdex returned 503" }))).toBe(
			"TCGdex returned 503",
		);
		expect(jobSummary(jobWith({ status: "interrupted" }))).toBe("interrupted by a restart");
	});
});
