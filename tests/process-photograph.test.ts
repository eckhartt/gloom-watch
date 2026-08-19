import { describe, expect, it } from "vitest";
import {
	InvalidPhotographError,
	PHOTOGRAPH_CONTENT_TYPE,
	PHOTOGRAPH_LONG_EDGE,
	processPhotograph,
} from "../server/copies/process-photograph.ts";
import { GPS_EXIF_MARKER, jpegWithGpsExif } from "./helpers/gps-jpeg.ts";

/**
 * The transform that makes owner photographs storable: resize, recompress to webp, strip EXIF.
 * Driven through the shipped function, not a parallel implementation and not a golden webp.
 */

function containsAscii(bytes: Uint8Array, ascii: string): boolean {
	const needle = Buffer.from(ascii, "ascii");
	return Buffer.from(bytes).includes(needle);
}

function longEdge(width: number, height: number): number {
	return Math.max(width, height);
}

describe("processPhotograph", () => {
	it("strips GPS EXIF so the marker in the JPEG does not survive in the stored webp", async () => {
		const jpeg = await jpegWithGpsExif(80, 60);
		expect(containsAscii(jpeg, GPS_EXIF_MARKER)).toBe(true);
		expect(containsAscii(jpeg, "Exif")).toBe(true);

		const stored = await processPhotograph(jpeg);

		expect(stored.contentType).toBe(PHOTOGRAPH_CONTENT_TYPE);
		expect(containsAscii(stored.bytes, GPS_EXIF_MARKER)).toBe(false);
		expect(containsAscii(stored.bytes, "Exif")).toBe(false);
		expect(containsAscii(stored.bytes, "EXIF")).toBe(false);
		expect(stored.bytes.subarray(0, 4)).toEqual(Buffer.from("RIFF"));
		expect(stored.bytes.subarray(8, 12)).toEqual(Buffer.from("WEBP"));
	});

	it("resizes so the long edge is 1600px and does not enlarge a smaller image", async () => {
		const large = await jpegWithGpsExif(2400, 1600);
		const shrunk = await processPhotograph(large);
		expect(longEdge(shrunk.width, shrunk.height)).toBe(PHOTOGRAPH_LONG_EDGE);
		expect(shrunk.width).toBe(PHOTOGRAPH_LONG_EDGE);
		expect(shrunk.height).toBeLessThan(PHOTOGRAPH_LONG_EDGE);
		expect(shrunk.height / shrunk.width).toBeCloseTo(1600 / 2400, 2);

		const small = await jpegWithGpsExif(80, 60);
		const left = await processPhotograph(small);
		expect(left.width).toBe(80);
		expect(left.height).toBe(60);
	});

	it("refuses a file that is not an image", async () => {
		await expect(processPhotograph(Buffer.from("this is not a photograph"))).rejects.toBeInstanceOf(
			InvalidPhotographError,
		);
	});
});
