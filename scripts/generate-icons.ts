/**
 * Generate the PWA icons committed under `public/`.
 *
 * The manifest needs a *real* icon, not a placeholder — on iOS a Home Screen web app whose
 * manifest is incomplete is the same failure mode as one with a default `display`, and it is
 * discovered late. Written as a script with no image dependencies so the icons are
 * reproducible: `bun run icons` regenerates byte-identical files.
 *
 * The mark is Oddish reduced to two shapes — a bulb and three leaves.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(repoRoot, "public");

type Rgb = readonly [number, number, number];

const GROUND: Rgb = [0x0c, 0x13, 0x10];
const BULB: Rgb = [0x5a, 0x78, 0xd6];
const LEAF: Rgb = [0x86, 0xe0, 0x8f];

interface Circle {
	/** Centre and radius, as fractions of the icon's edge. */
	readonly cx: number;
	readonly cy: number;
	readonly r: number;
	readonly colour: Rgb;
}

/** Painted back to front. */
function mark(scale: number): Circle[] {
	// `scale` shrinks the whole mark toward the centre so a maskable icon survives its safe zone.
	const s = (v: number) => 0.5 + (v - 0.5) * scale;
	const r = (v: number) => v * scale;
	return [
		{ cx: s(0.5), cy: s(0.28), r: r(0.13), colour: LEAF },
		{ cx: s(0.27), cy: s(0.4), r: r(0.115), colour: LEAF },
		{ cx: s(0.73), cy: s(0.4), r: r(0.115), colour: LEAF },
		{ cx: s(0.5), cy: s(0.64), r: r(0.245), colour: BULB },
	];
}

const SAMPLES = 4;

function renderRgba(size: number, circles: readonly Circle[]): Uint8Array {
	const pixels = new Uint8Array(size * size * 4);
	const step = 1 / (SAMPLES + 1);

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			let r = 0;
			let g = 0;
			let b = 0;

			// Supersample so the circles do not come out jagged at 192px.
			for (let sy = 1; sy <= SAMPLES; sy++) {
				for (let sx = 1; sx <= SAMPLES; sx++) {
					const px = (x + sx * step) / size;
					const py = (y + sy * step) / size;
					let colour = GROUND;
					for (const circle of circles) {
						const dx = px - circle.cx;
						const dy = py - circle.cy;
						if (dx * dx + dy * dy <= circle.r * circle.r) colour = circle.colour;
					}
					r += colour[0];
					g += colour[1];
					b += colour[2];
				}
			}

			const n = SAMPLES * SAMPLES;
			const offset = (y * size + x) * 4;
			pixels[offset] = Math.round(r / n);
			pixels[offset + 1] = Math.round(g / n);
			pixels[offset + 2] = Math.round(b / n);
			pixels[offset + 3] = 255;
		}
	}

	return pixels;
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(buffer: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
	const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([length, body, crc]);
}

function encodePng(size: number, rgba: Uint8Array): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0);
	header.writeUInt32BE(size, 4);
	header[8] = 8; // bit depth
	header[9] = 6; // colour type: RGBA
	header[10] = 0; // deflate
	header[11] = 0; // adaptive filtering
	header[12] = 0; // no interlace

	// One filter byte (0 = None) per scanline.
	const raw = Buffer.alloc(size * (size * 4 + 1));
	for (let y = 0; y < size; y++) {
		const rowStart = y * (size * 4 + 1);
		raw[rowStart] = 0;
		Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, rowStart + 1);
	}

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", new Uint8Array(0)),
	]);
}

interface IconSpec {
	readonly file: string;
	readonly size: number;
	/** 1 is full-bleed; a maskable icon needs its mark inside the 80% safe zone. */
	readonly scale: number;
}

const ICONS: readonly IconSpec[] = [
	{ file: "pwa-192x192.png", size: 192, scale: 1 },
	{ file: "pwa-512x512.png", size: 512, scale: 1 },
	{ file: "pwa-maskable-512x512.png", size: 512, scale: 0.7 },
	{ file: "apple-touch-icon.png", size: 180, scale: 1 },
];

mkdirSync(publicDir, { recursive: true });
for (const icon of ICONS) {
	const png = encodePng(icon.size, renderRgba(icon.size, mark(icon.scale)));
	writeFileSync(join(publicDir, icon.file), png);
	console.log(`${icon.file}  ${icon.size}x${icon.size}  ${png.length} bytes`);
}
