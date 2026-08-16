/**
 * How one binder entry looks, as pure functions over the entry.
 *
 * Kept out of the component deliberately. These are the two claims the ticket makes that are
 * checkable without a phone — that owned and needed are distinguishable, and that four variants
 * of one card are told apart — so they are written where a test can reach them without a DOM.
 */

import type { BinderEntry } from "../../shared/contract.ts";

export type CellState = "owned" | "needed";

export interface CellPresentation {
	readonly state: CellState;
	readonly owned: boolean;
	/** The tile's class. The CSS attached to it is what carries the distinction visually. */
	readonly className: string;
	/** The tile's accessible name — the same distinction, for anyone who cannot see the grid. */
	readonly label: string;
}

/**
 * Owned or needed, and the class that shows which.
 *
 * **The distinction has to survive without reading text**, so the classes drive colour and edge
 * rather than a caption: a needed cell is desaturated and dimmed behind a hairline rule, an owned
 * one is full-colour inside a solid leaf border with a filled corner mark. At a glance the binder
 * reads as art against holes, which is the whole point of the screen.
 *
 * `ownedCopies` is `0` for every entry on the live box today — the copies table is the next
 * ticket — so this function is currently only ever asked for one of its two answers. It is
 * written and proved for both now because deferring the visual treatment until copies exist
 * would mean shipping a binder nobody could check, and because a count of copies, not a boolean,
 * is what the next ticket will actually have.
 */
export function cellPresentation(entry: BinderEntry): CellPresentation {
	const owned = entry.ownedCopies > 0;
	const state: CellState = owned ? "owned" : "needed";
	return {
		state,
		owned,
		className: `binder-cell binder-cell-${state}`,
		label: `${entry.name}, ${entry.setName ?? entry.setId} ${entry.localId}, ${entry.language.toUpperCase()} — ${state}`,
	};
}

/* Short codes for the axes. Long enough to recognise, short enough for an 88px tile. */

const FINISH_CODES: Readonly<Record<string, string>> = {
	// `normal` is the default printing and would put a badge on two thirds of the grid for no
	// information at all. Only the finishes that are a collecting distinction get a mark.
	normal: "",
	holo: "HOLO",
	reverse: "REV",
};

const SUBTYPE_CODES: Readonly<Record<string, string>> = {
	unlimited: "UNL",
	shadowless: "SHDW",
	"shadowless-red-cheek": "REDCH",
	"1999-2000-copyright": "99–00",
	"missing-expansion-symbol": "NOSYM",
};

const STAMP_CODES: Readonly<Record<string, string>> = {
	"1st-edition": "1ED",
	"set-logo": "LOGO",
};

const FOIL_CODES: Readonly<Record<string, string>> = {
	"cracked-ice": "ICE",
	energy: "EN",
	pokeball: "PB",
	masterball: "MB",
};

/**
 * Anything not in the table is shown as its own canonical slug, upper-cased.
 *
 * **Never blank.** The corpus canonicalises upstream's localised axis strings and reports what it
 * could not place, and a value that arrived from a language nobody has looked at yet must show up
 * on the tile rather than silently render as an unmarked normal printing.
 */
function codeFor(table: Readonly<Record<string, string>>, value: string): string {
	return table[value] ?? value.toUpperCase();
}

/**
 * How many codes fit on the badge's own line at phone width.
 *
 * Measured rather than guessed: four columns on a 390-point iPhone gives an 86px tile, which
 * holds about fifteen monospaced characters at this size. Two codes and a separator is at most
 * twelve. Three would elide, and an elided badge is worse than a shorter one — the reader
 * cannot tell whether the hidden token mattered.
 */
const BADGE_TOKEN_LIMIT = 2;

/**
 * The tile's axis badge — what distinguishes this printing from its siblings.
 *
 * Images attach to the *card*, so four variants of Base Set Gloom are four cells carrying one
 * picture. Without this the binder shows the owner four identical tiles and no way to tell the
 * 1st Edition from the Unlimited, which is precisely the distinction the whole masterset exists
 * to make.
 *
 * Ordered by how loudly each axis speaks to a collector: the stamp first, then the print run,
 * then the finish, then the foil pattern. The full five axes are in the sheet; this is the two
 * that fit.
 */
export function variantBadge(entry: BinderEntry): string {
	const tokens: string[] = [];
	for (const stamp of entry.stamps) tokens.push(codeFor(STAMP_CODES, stamp));
	if (entry.subtype !== null) tokens.push(codeFor(SUBTYPE_CODES, entry.subtype));
	if (entry.finish !== null) tokens.push(codeFor(FINISH_CODES, entry.finish));
	if (entry.foil !== null) tokens.push(codeFor(FOIL_CODES, entry.foil));

	return tokens
		.filter((token) => token !== "")
		.slice(0, BADGE_TOKEN_LIMIT)
		.join(" · ");
}

export interface AxisRow {
	readonly label: string;
	readonly value: string;
}

/**
 * The five axes, as the sheet lists them.
 *
 * All five, always, including the ones upstream did not set — an absent `foil` is a fact about
 * the printing, and a sheet that hides its empty rows makes the reader wonder whether the axis
 * exists at all. `stamps` is a list and is rendered as one; `size` is stored and not filterable,
 * and is shown for completeness.
 */
export function axisRows(entry: BinderEntry): AxisRow[] {
	return [
		{ label: "Finish", value: entry.finish ?? "—" },
		{ label: "Subtype", value: entry.subtype ?? "—" },
		{ label: "Stamps", value: entry.stamps.length === 0 ? "—" : entry.stamps.join(", ") },
		{ label: "Foil", value: entry.foil ?? "—" },
		{ label: "Size", value: entry.size ?? "—" },
	];
}

/**
 * The set line: name, then release date, then the number as printed.
 *
 * The date is rendered **verbatim from the ISO string**, never through `new Date(...)`. Parsing
 * `1999-06-16` yields midnight UTC, which formatted in the owner's Brisbane timezone is the
 * 16th, but in any timezone west of UTC is the 15th — a released-on date that changes depending
 * on where you read it. It is a calendar date, not an instant, and this is where that convention
 * either holds or quietly breaks.
 */
export function setLine(entry: BinderEntry): string {
	const name = entry.setName ?? entry.setId;
	const date = entry.setReleaseDate ?? "no release date";
	return `${name} · ${date} · ${entry.localId}`;
}
