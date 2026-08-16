/**
 * Money, as the spec fixes it: an **integer count of the currency's minor units, always paired
 * with an ISO 4217 code**. Never a float, never a bare number.
 *
 * The pairing is not decoration. `1250` is $12.50 in AUD and ¥1,250 in JPY, and a number stored
 * without its code is a value nobody can ever read back. That is why the amount and the code are
 * two columns that are written together, and why every function here takes both.
 *
 * **There is no FX API and there never will be one in this design.** The home-currency amount is
 * typed by the owner along with the date the rate was taken, so nothing in here converts between
 * currencies — it only moves the decimal point within one.
 */

/**
 * The currency the owner keeps their books in.
 *
 * A constant rather than a setting, because it is not one yet: nothing in the app reads it as a
 * tunable and a settings screen that offered to change it would have to say what happens to the
 * `price_home_minor` amounts already stored against the old one. Fixed here, in one place, for
 * whichever ticket needs to answer that.
 */
export const HOME_CURRENCY = "AUD";

/**
 * ISO 4217 codes with **no** minor unit.
 *
 * The trap this exists to stop: `¥4,200` is **4200** minor units, not 420,000. A blanket
 * multiply-by-a-hundred stores every Japanese price a hundred times too large, and since a large
 * part of this masterset is Japanese it would be most of the collection. Listed rather than
 * derived because there is no runtime source for it that does not depend on the ICU version the
 * runtime was built against, and a price that changes because Bun updated is not a price.
 */
const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
	"BIF",
	"CLP",
	"DJF",
	"GNF",
	"ISK",
	"JPY",
	"KMF",
	"KRW",
	"PYG",
	"RWF",
	"UGX",
	"UYI",
	"VND",
	"VUV",
	"XAF",
	"XOF",
	"XPF",
]);

/** ISO 4217 codes with **three** minor digits. Rare, and wrong by ten if assumed to be two. */
const THREE_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
	"BHD",
	"IQD",
	"JOD",
	"KWD",
	"LYD",
	"OMR",
	"TND",
]);

/** How many digits of minor unit this currency has. Two unless it is one of the exceptions. */
export function minorUnitExponent(currency: string): number {
	const code = currency.toUpperCase();
	if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
	if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
	return 2;
}

/**
 * The shape of an ISO 4217 code, which is all that can be checked without a table nobody
 * maintains. Three letters, upper case. It rejects `$`, `12`, `aud ` and an empty string, which
 * are the ways a currency actually arrives wrong.
 */
const CURRENCY_CODE = /^[A-Z]{3}$/;

export function isCurrencyCode(value: unknown): value is string {
	return typeof value === "string" && CURRENCY_CODE.test(value);
}

/** Digits, optionally a decimal point and more digits. No sign: a price paid is not negative. */
const DECIMAL_AMOUNT = /^(\d+)(?:\.(\d+))?$/;

/**
 * Turn what the owner typed into minor units, or `null` if it is not an amount.
 *
 * **More decimal places than the currency has is a rejection, never a rounding.** `12.567` USD is
 * not $12.57 — it is a typo, and silently rounding it stores a number the owner never entered and
 * cannot see is wrong. `4200.5` JPY is likewise rejected rather than truncated.
 */
export function parseAmountToMinor(amount: string, currency: string): number | null {
	const trimmed = amount.trim().replace(/,/g, "");
	const match = DECIMAL_AMOUNT.exec(trimmed);
	if (match === null) return null;

	const whole = match[1] ?? "";
	const fraction = match[2] ?? "";
	const exponent = minorUnitExponent(currency);
	if (fraction.length > exponent) return null;

	const padded = fraction.padEnd(exponent, "0");
	const minor = Number(`${whole}${padded}`);
	return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units back to the amount as written, without the code. `1250` AUD → `12.50`. */
export function formatMinorAmount(minor: number, currency: string): string {
	const exponent = minorUnitExponent(currency);
	if (exponent === 0) return String(minor);

	const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");
	const whole = digits.slice(0, digits.length - exponent);
	const fraction = digits.slice(digits.length - exponent);
	return `${minor < 0 ? "-" : ""}${whole}.${fraction}`;
}

/**
 * The amount and its code, together, in that order — `12.50 AUD`.
 *
 * Not `Intl.NumberFormat`: its grouping, its symbol and its placement all depend on the ICU
 * version the runtime was built against, and the binder's card ordering was hand-rolled for the
 * same reason. A price the owner typed should read back exactly as they typed it.
 */
export function formatMoney(minor: number, currency: string): string {
	return `${formatMinorAmount(minor, currency)} ${currency.toUpperCase()}`;
}
