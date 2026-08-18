import { createHmac } from "node:crypto";

/**
 * The only permitted derivative of an eBay seller username: HMAC-SHA-256 keyed by
 * `RELIST_HASH_SALT`, lowercase hex.
 *
 * Named in the spec so fixtures are portable and the value is stable across a restore. Two
 * builders picking different functions would make every fixture and every restored database
 * disagree with the live one.
 *
 * The username enters this function and does not leave it. The hash is the relist-dedupe key
 * and is never displayed, never sent on the wire, never logged.
 */
export function hashSellerUsername(username: string, salt: string): string {
	return createHmac("sha256", salt).update(username, "utf8").digest("hex");
}
