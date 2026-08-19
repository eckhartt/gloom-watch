import { describe, expect, it } from "vitest";
import { decideQueueState } from "../server/queue/score.ts";
import type { ListingResolution } from "../shared/matcher.ts";
import { MATCHER_VERSION } from "../shared/matcher.ts";
import { MATCH_CONFIDENCE_THRESHOLD } from "../shared/queue.ts";

function match(partial: Partial<ListingResolution>): ListingResolution {
	return {
		grain: "none",
		cardKey: null,
		variantId: null,
		candidates: null,
		language: "en",
		confidence: 0,
		matcherVersion: MATCHER_VERSION,
		isLot: false,
		lotNames: null,
		filterVerdict: "pass",
		filterReason: null,
		parsedGrader: null,
		parsedGrade: null,
		...partial,
	};
}

describe("decideQueueState", () => {
	it("queues an unmatched title and a low-confidence hit", () => {
		expect(decideQueueState(match({ grain: "none" }), null)).toBe("queued");
		expect(
			decideQueueState(
				match({
					grain: "variant",
					cardKey: "en:base2-44",
					variantId: "x",
					confidence: MATCH_CONFIDENCE_THRESHOLD - 0.01,
				}),
				null,
			),
		).toBe("queued");
	});

	it("auto-matches a confident variant and leaves lots and filtered titles off the queue", () => {
		expect(
			decideQueueState(
				match({
					grain: "variant",
					cardKey: "en:base2-44",
					variantId: "x",
					confidence: MATCH_CONFIDENCE_THRESHOLD,
				}),
				null,
			),
		).toBe("auto_matched");
		expect(decideQueueState(match({ grain: "none", isLot: true, lotNames: ["Gloom"] }), null)).toBe(
			"auto_matched",
		);
		expect(
			decideQueueState(
				match({ grain: "none", filterVerdict: "filtered", filterReason: "proxy" }),
				null,
			),
		).toBe("auto_matched");
	});

	it("queues a card-grain hit when the owner holds some but not all printings", () => {
		expect(
			decideQueueState(
				match({
					grain: "card",
					cardKey: "en:base2-44",
					candidates: [],
					confidence: 0.95,
				}),
				{ owned: 1, total: 2 },
			),
		).toBe("queued");
		expect(
			decideQueueState(
				match({
					grain: "card",
					cardKey: "en:base2-44",
					candidates: [],
					confidence: 0.95,
				}),
				{ owned: 0, total: 2 },
			),
		).toBe("auto_matched");
	});
});
