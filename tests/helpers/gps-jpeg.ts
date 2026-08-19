/**
 * A real JPEG with GPS EXIF, including a distinctive ASCII marker in the GPS IFD.
 *
 * The photographs ticket requires a test that feeds GPS-bearing bytes into the shipped
 * processor and asserts they do not survive. The marker is written here, in the fixture, so
 * the assertion is looking for the same string the JPEG actually contains — not a golden
 * webp, and not a reimplementation of the stripper.
 */

import sharp from "sharp";

/** ASCII in the GPS Processing Method tag. Unique enough that a chance hit in webp is implausible. */
export const GPS_EXIF_MARKER = "GLOOMWATCH-GPS-HOME";

export async function jpegWithGpsExif(width = 48, height = 32): Promise<Uint8Array> {
	const jpeg = await sharp({
		create: {
			width,
			height,
			channels: 3,
			background: { r: 24, g: 72, b: 40 },
		},
	})
		.jpeg({ quality: 80 })
		.toBuffer();
	return injectExifApp1(jpeg, buildGpsExifTiff());
}

function injectExifApp1(jpeg: Uint8Array, tiff: Uint8Array): Uint8Array {
	if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
		throw new Error("sharp did not produce a JPEG");
	}
	const exifHeader = Buffer.from("Exif\0\0", "binary");
	const payloadLength = 2 + exifHeader.byteLength + tiff.byteLength;
	const app1 = new Uint8Array(2 + payloadLength);
	app1[0] = 0xff;
	app1[1] = 0xe1;
	app1[2] = (payloadLength >> 8) & 0xff;
	app1[3] = payloadLength & 0xff;
	app1.set(exifHeader, 4);
	app1.set(tiff, 4 + exifHeader.byteLength);

	const out = new Uint8Array(2 + app1.byteLength + (jpeg.byteLength - 2));
	out[0] = 0xff;
	out[1] = 0xd8;
	out.set(app1, 2);
	out.set(jpeg.subarray(2), 2 + app1.byteLength);
	return out;
}

/**
 * Little-endian TIFF: IFD0 points at a GPS IFD that carries version, lat/lon, and the marker
 * as GPSProcessingMethod. Offsets are from the start of the TIFF header.
 *
 * Layout:
 *   0   header (8)
 *   8   IFD0, one entry (18)
 *   26  GPS IFD, six entries (78)
 *   104 latitude rationals (24)
 *   128 longitude rationals (24)
 *   152 processing method (28)
 */
function buildGpsExifTiff(): Uint8Array {
	const processing = Buffer.concat([
		Buffer.from("ASCII\0\0\0", "binary"),
		Buffer.from(GPS_EXIF_MARKER, "ascii"),
		Buffer.from([0]),
	]);

	const tiff = new Uint8Array(152 + processing.byteLength);
	const view = new DataView(tiff.buffer);

	// TIFF header: little-endian, magic 42, first IFD at 8.
	tiff[0] = 0x49;
	tiff[1] = 0x49;
	view.setUint16(2, 42, true);
	view.setUint32(4, 8, true);

	// IFD0: GPS IFD pointer (tag 0x8825), type LONG, count 1, offset 26.
	view.setUint16(8, 1, true);
	writeIfdEntry(view, 10, 0x8825, 4, 1, 26);
	view.setUint32(22, 0, true);

	// GPS IFD at 26.
	const gps = 26;
	view.setUint16(gps, 6, true);
	writeIfdEntry(view, gps + 2, 0x0000, 1, 4, bytesToU32(2, 3, 0, 0));
	writeIfdEntry(view, gps + 14, 0x0001, 2, 2, bytesToU32(0x53, 0x00, 0x00, 0x00)); // "S"
	writeIfdEntry(view, gps + 26, 0x0002, 5, 3, 104);
	writeIfdEntry(view, gps + 38, 0x0003, 2, 2, bytesToU32(0x45, 0x00, 0x00, 0x00)); // "E"
	writeIfdEntry(view, gps + 50, 0x0004, 5, 3, 128);
	writeIfdEntry(view, gps + 62, 0x001b, 7, processing.byteLength, 152);
	view.setUint32(gps + 74, 0, true);

	writeRational(view, 104, 27, 1);
	writeRational(view, 112, 28, 1);
	writeRational(view, 120, 1913, 100);
	writeRational(view, 128, 153, 1);
	writeRational(view, 136, 1, 1);
	writeRational(view, 144, 3036, 100);
	tiff.set(processing, 152);
	return tiff;
}

function writeIfdEntry(
	view: DataView,
	at: number,
	tag: number,
	type: number,
	count: number,
	valueOrOffset: number,
): void {
	view.setUint16(at, tag, true);
	view.setUint16(at + 2, type, true);
	view.setUint32(at + 4, count, true);
	view.setUint32(at + 8, valueOrOffset, true);
}

function writeRational(view: DataView, at: number, numerator: number, denominator: number): void {
	view.setUint32(at, numerator, true);
	view.setUint32(at + 4, denominator, true);
}

function bytesToU32(a: number, b: number, c: number, d: number): number {
	return a | (b << 8) | (c << 16) | (d << 24);
}
