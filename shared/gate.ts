/**
 * The public-origin gate. A shared secret on `/api/*`, except the two paths that cannot
 * have one: the unlock form that sets the cookie, and eBay's account-deletion callback.
 *
 * Not a user database. One value in the environment file, one cookie.
 */

export const UNLOCK_PATH = "/unlock";
export const UNLOCK_API_PATH = "/api/unlock";

/** eBay's challenge GET and deletion POST. Must match the URL pasted into the portal exactly. */
export const EBAY_ACCOUNT_DELETION_PATH = "/api/ebay/marketplace-account-deletion";

export const GATE_COOKIE = "gloom_gate";
