import { createDecipheriv, createECDH, createHmac, randomBytes } from "node:crypto";

/**
 * The receiving half of Web Push, implemented for the tests.
 *
 * iOS Web Push cannot be exercised in CI — it needs a physical iPhone, a real HTTPS origin and a
 * Home Screen install. What *can* be proved without a device is everything up to the moment the
 * phone decrypts the message: that the request carries the right headers, and that what comes out
 * of RFC 8291 decryption is byte-for-byte the payload the sender meant to send.
 *
 * That matters more here than it usually would. Three pushes that fail to display revoke every
 * subscription for the origin and the counter never decays, so the payload has to be known-good
 * *before* the first real send rather than debugged afterwards.
 *
 * RFC 8291 §3.4, receiver side, with the key derivation of RFC 8188 (`aes128gcm`).
 */

function hkdfExpandOnce(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
	const prk = createHmac("sha256", salt).update(ikm).digest();
	return createHmac("sha256", prk)
		.update(Buffer.concat([info, Buffer.of(1)]))
		.digest()
		.subarray(0, length);
}

export interface FakeDevice {
	/** The device's P-256 public key, base64url — what the browser calls `keys.p256dh`. */
	readonly p256dh: string;
	/** The device's auth secret, base64url — what the browser calls `keys.auth`. */
	readonly auth: string;
	/** Decrypt an `aes128gcm` push body back to its plaintext. Throws if it does not authenticate. */
	decrypt(body: Uint8Array): string;
}

/** A device that can receive a push, with real keys rather than fixtures. */
export function createFakeDevice(): FakeDevice {
	const ecdh = createECDH("prime256v1");
	ecdh.generateKeys();
	const devicePublic = ecdh.getPublicKey();
	const authSecret = randomBytes(16);

	return {
		p256dh: devicePublic.toString("base64url"),
		auth: authSecret.toString("base64url"),
		decrypt(body: Uint8Array): string {
			const message = Buffer.from(body);

			// Header: salt(16) | record size(4) | key id length(1) | key id
			const salt = message.subarray(0, 16);
			const keyIdLength = message.readUInt8(20);
			const senderPublic = message.subarray(21, 21 + keyIdLength);
			const ciphertext = message.subarray(21 + keyIdLength);

			const sharedSecret = ecdh.computeSecret(senderPublic);
			const pseudoRandomKey = createHmac("sha256", authSecret).update(sharedSecret).digest();
			const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), devicePublic, senderPublic]);
			const ikm = createHmac("sha256", pseudoRandomKey)
				.update(Buffer.concat([keyInfo, Buffer.of(1)]))
				.digest();

			const key = hkdfExpandOnce(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
			const nonce = hkdfExpandOnce(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

			const decipher = createDecipheriv("aes-128-gcm", key, nonce);
			decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
			const padded = Buffer.concat([
				decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
				decipher.final(),
			]);

			// Strip the padding: zero bytes back to the delimiter, which is 0x02 on the last record.
			let end = padded.length;
			while (end > 0 && padded[end - 1] === 0) end -= 1;
			return padded.subarray(0, Math.max(end - 1, 0)).toString("utf8");
		},
	};
}

export interface CapturedPush {
	readonly path: string;
	readonly headers: Record<string, string>;
	readonly body: Uint8Array;
}

export interface FakePushService {
	readonly origin: string;
	readonly received: CapturedPush[];
	/** Answer the next request with this status. Defaults to 201, as a push service does. */
	respondWith(status: number, body?: string): void;
	stop(): Promise<void>;
}

/** A stand-in for `web.push.apple.com` that records what arrives and answers how it is told to. */
export function startFakePushService(): FakePushService {
	const received: CapturedPush[] = [];
	let status = 201;
	let responseBody = "";

	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			received.push({
				path: new URL(request.url).pathname,
				headers: Object.fromEntries(request.headers.entries()),
				body: new Uint8Array(await request.arrayBuffer()),
			});
			return new Response(responseBody, { status });
		},
	});

	return {
		origin: `http://127.0.0.1:${server.port}`,
		received,
		respondWith(nextStatus: number, nextBody = "") {
			status = nextStatus;
			responseBody = nextBody;
		},
		async stop() {
			await server.stop(true);
		},
	};
}
