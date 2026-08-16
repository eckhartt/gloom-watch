/**
 * What the owner typed, turned into what the wire carries.
 *
 * **The split with the server is deliberate: the client converts, the server validates.** The
 * server never sees `8.5` or `12.50` — it receives `85` tenths and `1250` minor units, because a
 * decimal string is a display of an amount and not the amount itself. So the conversions live
 * here, where the typed string is, and the cross-field rules — a grade needs a grader, a
 * home-currency amount needs its rate date — live on the server, where they can hold for the
 * import route and the outbox replay as well as for this form. Duplicating them here would put
 * the same rule in three places and guarantee that one day two of them disagree.
 *
 * Pure, and separate from the component, so the arithmetic that can be wrong about money can be
 * checked without a browser.
 */

import type { CopyDocument, CopyFields } from "../../shared/copies.ts";
import { formatGradeTenths, parseGradeTenths } from "../../shared/copies.ts";
import { formatMinorAmount, HOME_CURRENCY, parseAmountToMinor } from "../../shared/money.ts";

/** Every field as the form holds it: a string, because that is what an `<input>` has. */
export interface CopyFormValues {
	condition: string;
	grader: string;
	/** As the grader prints it — `8.5`, not `85`. Converted on the way out. */
	grade: string;
	certNo: string;
	/** As written — `12.50`. Converted to minor units on the way out. */
	priceAmount: string;
	currency: string;
	homeAmount: string;
	homeCurrency: string;
	rateDate: string;
	acquiredAt: string;
	sourceType: string;
	sourceNote: string;
	note: string;
}

export const EMPTY_COPY_FORM: CopyFormValues = {
	condition: "",
	grader: "",
	grade: "",
	certNo: "",
	priceAmount: "",
	// Pre-filled because most cards are bought at home and a currency box left blank alongside a
	// price is the mistake this design refuses to store.
	currency: HOME_CURRENCY,
	homeAmount: "",
	homeCurrency: HOME_CURRENCY,
	rateDate: "",
	acquiredAt: "",
	sourceType: "",
	sourceNote: "",
	note: "",
};

/** An existing copy, back into the form, for editing. The inverse of `copyFieldsFrom`. */
export function copyFormFrom(copy: CopyDocument): CopyFormValues {
	return {
		condition: copy.condition ?? "",
		grader: copy.grader ?? "",
		grade: copy.grade === null ? "" : formatGradeTenths(copy.grade),
		certNo: copy.certNo ?? "",
		priceAmount:
			copy.priceMinor === null || copy.currency === null
				? ""
				: formatMinorAmount(copy.priceMinor, copy.currency),
		currency: copy.currency ?? HOME_CURRENCY,
		homeAmount:
			copy.priceHomeMinor === null || copy.homeCurrency === null
				? ""
				: formatMinorAmount(copy.priceHomeMinor, copy.homeCurrency),
		homeCurrency: copy.homeCurrency ?? HOME_CURRENCY,
		rateDate: copy.rateDate ?? "",
		acquiredAt: copy.acquiredAt ?? "",
		sourceType: copy.sourceType ?? "",
		sourceNote: copy.sourceNote ?? "",
		note: copy.note ?? "",
	};
}

export type CopyFormResult =
	| { readonly ok: true; readonly fields: CopyFields }
	| { readonly ok: false; readonly message: string };

function blank(value: string): boolean {
	return value.trim() === "";
}

/**
 * The form's values as the fields the wire carries — **every field present, absent ones as
 * `null`**.
 *
 * Explicitly `null` rather than omitted because this feeds an edit as well as a create, and the
 * patch route reads an absent key as *leave it alone*. A price the owner deleted has to arrive as
 * `null` or it survives the edit that removed it.
 */
export function copyFieldsFrom(values: CopyFormValues): CopyFormResult {
	let grade: number | null = null;
	if (!blank(values.grade)) {
		grade = parseGradeTenths(values.grade);
		if (grade === null) {
			return {
				ok: false,
				message: "a grade reads like 8.5 or 10, between 1 and 10",
			};
		}
	}

	const price = amountToMinor(values.priceAmount, values.currency, "price");
	if (!price.ok) return price;
	const home = amountToMinor(values.homeAmount, values.homeCurrency, "home value");
	if (!home.ok) return home;

	return {
		ok: true,
		fields: {
			condition: (blank(values.condition) ? null : values.condition) as CopyFields["condition"],
			grader: (blank(values.grader) ? null : values.grader) as CopyFields["grader"],
			grade,
			certNo: blank(values.certNo) ? null : values.certNo.trim(),
			priceMinor: price.minor,
			currency: price.minor === null ? null : values.currency.trim().toUpperCase(),
			priceHomeMinor: home.minor,
			homeCurrency: home.minor === null ? null : values.homeCurrency.trim().toUpperCase(),
			rateDate: blank(values.rateDate) ? null : values.rateDate,
			acquiredAt: blank(values.acquiredAt) ? null : values.acquiredAt,
			sourceType: (blank(values.sourceType) ? null : values.sourceType) as CopyFields["sourceType"],
			sourceNote: blank(values.sourceNote) ? null : values.sourceNote.trim(),
			note: blank(values.note) ? null : values.note.trim(),
		},
	};
}

type AmountResult = { ok: true; minor: number | null } | { ok: false; message: string };

/**
 * An amount, in the minor units of *its own* currency.
 *
 * The trap the currency argument exists for: `¥4,200` is 4200 minor units and `$42.00` is 4200
 * too, but `4200` yen typed into a two-decimal conversion becomes 420,000 — a hundred times the
 * price, stored silently, on a collection that is largely Japanese.
 */
function amountToMinor(amount: string, currency: string, what: string): AmountResult {
	if (blank(amount)) return { ok: true, minor: null };
	if (blank(currency)) return { ok: false, message: `a ${what} needs its currency` };

	const minor = parseAmountToMinor(amount, currency);
	if (minor === null) {
		// Rejected rather than rounded. `12.567` USD is a typo, and a silent round stores an amount
		// the owner never entered and has no way to notice is wrong.
		return { ok: false, message: `${amount} is not an amount in ${currency.toUpperCase()}` };
	}
	return { ok: true, minor };
}
