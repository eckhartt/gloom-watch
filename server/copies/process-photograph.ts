/**
 * Resize and recompress an owner photograph on receipt.
 *
 * A raw iPhone photo is 3–5 MB and carries GPS in EXIF. Storing that is how the database would
 * stop being a database, and how a photograph taken at home would keep a location. The spec
 * therefore requires this transform **server-side**: the outbox never parks the original, and the
 * blob that lands is webp at ~1600px on the long edge with the EXIF gone.
 *
 * Encoding to webp without copying metadata is what strips EXIF. `autoOrient` applies the
 * Orientation tag first so a phone photo taken sideways is stored the right way up, then drops
 * the tag with the rest.
 */

import sharp from "sharp";

export const PHOTOGRAPH_LONG_EDGE = 1600;
export const PHOTOGRAPH_WEBP_QUALITY = 80;
export const PHOTOGRAPH_CONTENT_TYPE = "image/webp";
/** iPhone photos are a few megabytes. Anything past this is not a card photograph. */
export const PHOTOGRAPH_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export class InvalidPhotographError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidPhotographError";
	}
}

export interface ProcessedPhotograph {
	readonly bytes: Buffer;
	readonly width: number;
	readonly height: number;
	readonly contentType: typeof PHOTOGRAPH_CONTENT_TYPE;
}

export async function processPhotograph(input: Uint8Array): Promise<ProcessedPhotograph> {
	if (input.byteLength === 0) {
		throw new InvalidPhotographError("a photograph cannot be empty");
	}
	if (input.byteLength > PHOTOGRAPH_MAX_UPLOAD_BYTES) {
		throw new InvalidPhotographError("that photograph is too large to store");
	}

	try {
		const { data, info } = await sharp(input)
			.autoOrient()
			.resize({
				width: PHOTOGRAPH_LONG_EDGE,
				height: PHOTOGRAPH_LONG_EDGE,
				fit: "inside",
				withoutEnlargement: true,
			})
			.webp({ quality: PHOTOGRAPH_WEBP_QUALITY })
			.toBuffer({ resolveWithObject: true });

		if (info.width < 1 || info.height < 1) {
			throw new InvalidPhotographError("that file is not an image this app can store");
		}

		return {
			bytes: data,
			width: info.width,
			height: info.height,
			contentType: PHOTOGRAPH_CONTENT_TYPE,
		};
	} catch (cause) {
		if (cause instanceof InvalidPhotographError) throw cause;
		throw new InvalidPhotographError("that file is not an image this app can store");
	}
}
