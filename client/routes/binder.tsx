import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BinderEntry } from "../../shared/contract.ts";
import { binderEntryKey, corpusCardImagePath } from "../../shared/contract.ts";
import type { ManualVariantDocument } from "../../shared/manual.ts";
import { CopiesPanel } from "../binder/copies-panel.tsx";
import { FilterSheet } from "../binder/filter-sheet.tsx";
import type { BinderFilters, FilterAxis } from "../binder/filters.ts";
import {
	DEFAULT_FILTERS,
	DEFAULT_LANGUAGE,
	extraFilterCount,
	filterEntries,
	filterFacets,
	filtersFromSearch,
	searchFromFilters,
	setFilterAxis,
	setFilterNumber,
	toggleFilterValue,
} from "../binder/filters.ts";
import { BlankManualEntry, ManualVariantControls } from "../binder/manual-form.tsx";
import {
	axisRows,
	cellPresentation,
	ownershipLine,
	setLine,
	variantBadge,
} from "../binder/presentation.ts";
import { binderQueryOptions } from "../collection.ts";

/**
 * The binder — the app's primary surface, and the screen the whole design is built around.
 *
 * Four properties are load-bearing and each is visible in the code below:
 *
 * **One document.** The whole masterset arrives in a single request and lives in one query. It
 * is never paged and never re-fetched per cell, which is what lets the service worker hold the
 * binder for offline browsing and what lets the filters run without a round trip.
 *
 * **Filtering is local.** The predicate runs over the entries already in memory. Nothing here
 * fetches when a chip is tapped; `GET /api/binder` takes no parameters and never will, because
 * the service worker caches by URL and a URL that varied by filter would leave the phone holding
 * one arbitrary slice of the masterset. **The Gap is a filter, not a screen** — "what I still
 * need" is a selection on this route, so the owner never loses the binder to look at their holes.
 *
 * **Virtualised.** ~765 cells is more than a phone will paint at sixty frames a second. Only the
 * rows in view exist in the DOM; the rest are height. The virtualiser works in *rows* rather
 * than cells — one measurement axis instead of two, and the column count is a pure function of
 * the container's width, so a rotation re-lays-out without a second virtualiser to keep in sync.
 *
 * **Neither sheet is a route.** Tapping a card, or opening the filters, sets a piece of component
 * state. The grid is not unmounted, no navigation happens — so dismissing a sheet returns to the
 * same scroll offset because the scroll container was never touched. The filters *do* move the
 * URL, but only its search parameters, which does not re-mount this component.
 */

/** The narrowest a card tile may be before another column is dropped. */
const MIN_CELL_WIDTH = 84;
/** Space between tiles and around the grid, in pixels. */
const GUTTER = 6;
/** A Pokémon card is 63 × 88 mm. The tile's art keeps that ratio so the grid reads as a binder. */
const CARD_ASPECT = 63 / 88;
/** Two lines of caption under each tile: the number, and the axis badge. */
const CAPTION_HEIGHT = 28;
/** Rows rendered beyond the viewport, so a flick does not reveal blank space. */
const OVERSCAN_ROWS = 4;

const NO_ENTRIES: readonly BinderEntry[] = [];

interface GridMetrics {
	readonly columns: number;
	readonly cellWidth: number;
	readonly artHeight: number;
	readonly rowHeight: number;
}

/**
 * Column count and tile size from the container's width.
 *
 * Pure, and exported for no other reason than that it is the arithmetic most likely to be wrong
 * on a device nobody has in hand: a phone at 390 CSS pixels gets four columns of 90px, an iPad
 * gets ten, and a 320px iPhone SE still gets three rather than collapsing to one enormous card.
 */
export function gridMetrics(width: number): GridMetrics {
	const usable = Math.max(width - GUTTER, 0);
	const columns = Math.max(2, Math.floor(usable / (MIN_CELL_WIDTH + GUTTER)));
	const cellWidth = Math.max(Math.floor((width - GUTTER * (columns + 1)) / columns), 1);
	const artHeight = Math.round(cellWidth / CARD_ASPECT);
	return { columns, cellWidth, artHeight, rowHeight: artHeight + CAPTION_HEIGHT + GUTTER };
}

function BinderCell({
	entry,
	metrics,
	onOpen,
}: {
	entry: BinderEntry;
	metrics: GridMetrics;
	onOpen: (key: string) => void;
}) {
	const presentation = cellPresentation(entry);
	const badge = variantBadge(entry);

	return (
		<button
			type="button"
			className={presentation.className}
			style={{ width: metrics.cellWidth }}
			onClick={() => onOpen(entry.key)}
			aria-label={presentation.label}
		>
			<span className="binder-art" style={{ height: metrics.artHeight }}>
				{entry.hasImage ? (
					// `alt` is empty on purpose: the button already carries the accessible name, and a
					// second reading of the card's name per cell would make the grid unusable to a
					// screen reader. 115 of 497 cards have no image upstream, hence the fallback.
					<img
						src={corpusCardImagePath(entry.cardKey)}
						alt=""
						loading="lazy"
						decoding="async"
						width={metrics.cellWidth}
						height={metrics.artHeight}
					/>
				) : (
					<span className="binder-art-missing">{entry.name}</span>
				)}
			</span>
			<span className="binder-caption">
				<span className="binder-number">
					{entry.language.toUpperCase()} {entry.localId}
				</span>
				<span className="binder-badge">{badge}</span>
			</span>
		</button>
	);
}

/**
 * The variant sheet.
 *
 * It shows the corpus image, the variant's axes and the copies the owner holds of it — adding,
 * editing and disposing of one all happen here. Photographs and current listings are later tickets
 * and there is no placeholder for either: the spec records the sheet's layout as still undecided,
 * and a box reserved for something nobody has designed is a design decision made by accident.
 *
 * Rendered as a sibling of the scroll container rather than inside it, so the grid keeps its
 * scroll offset and the sheet is not itself scrolled away. Escape and the backdrop both dismiss,
 * because a Home Screen web app has no browser chrome to fall back on.
 */
function BinderSheet({
	entry,
	onClose,
	onCreated,
	onDeleted,
}: {
	entry: BinderEntry;
	onClose: () => void;
	onCreated: (created: ManualVariantDocument) => void;
	onDeleted: () => void;
}) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	const presentation = cellPresentation(entry);

	return (
		<div className="sheet-layer">
			{/* Dismissal by tapping away. Not focusable — Escape and the close button are the
			    keyboard routes, and a tabbable backdrop would sit between them. */}
			<div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
			<section className="sheet" role="dialog" aria-modal="true" aria-label={presentation.label}>
				<header className="sheet-head">
					<div>
						<h2 className="sheet-name">{entry.name}</h2>
						<p className="sheet-set">{setLine(entry)}</p>
					</div>
					<button type="button" className="quiet" onClick={onClose}>
						Close
					</button>
				</header>

				<div className="sheet-body">
					{entry.hasImage ? (
						<img className="sheet-art" src={corpusCardImagePath(entry.cardKey)} alt={entry.name} />
					) : (
						<p className="sheet-art-missing muted">
							No corpus image — upstream carries none for this card.
						</p>
					)}

					<dl className="sheet-facts">
						<Fact label="State" value={ownershipLine(entry)} />
						<Fact label="Language" value={entry.language} />
						<Fact label="Rarity" value={entry.rarity ?? "—"} />
						{axisRows(entry).map((row) => (
							<Fact key={row.label} label={row.label} value={row.value} />
						))}
						{entry.missingUpstream ? (
							// Flagged, never deleted. Worth saying on the sheet: the row is still in the
							// masterset and still counts, and the owner should know upstream dropped it.
							<Fact label="Upstream" value="flagged missing" tone="alarm" />
						) : null}
						{entry.provenance === "manual" ? <Fact label="Provenance" value="hand-added" /> : null}
					</dl>
				</div>

				<ManualVariantControls
					key={`manual-${entry.key}`}
					entry={entry}
					onCreated={onCreated}
					onDeleted={onDeleted}
				/>
				{/* Keyed on the variant so the panel's own state — a half-filled form, the copy being
				    edited, an in-flight priority — cannot survive into a different card. Dismissing the
				    sheet unmounts it today and there is no way to move between variants without
				    dismissing, but the key is what makes that a property rather than a coincidence. */}
				<CopiesPanel key={entry.key} entry={entry} />
			</section>
		</div>
	);
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: "alarm" }) {
	return (
		<div className="row">
			<dt>{label}</dt>
			<dd className={tone === "alarm" ? "alarm" : undefined}>{value}</dd>
		</div>
	);
}

export function BinderScreen() {
	const binder = useQuery(binderQueryOptions());

	// **The filter state is the URL.** There is no `useState` mirroring it: a copy would be the
	// thing that disagrees after a reload, and surviving a reload is the criterion.
	const search = useSearch({ from: "/" });
	const navigate = useNavigate({ from: "/" });
	const filters = useMemo(() => filtersFromSearch(search), [search]);

	const applyFilters = useCallback(
		(next: BinderFilters) => {
			// `replace` rather than a push. A chip is not navigation, and on a Home Screen web app
			// the edge swipe is the only back gesture there is — twenty filter states in the history
			// stack would make it useless for leaving the binder, which is the only thing it is for.
			void navigate({ search: searchFromFilters(next), replace: true });
		},
		[navigate],
	);

	const onToggleFilter = useCallback(
		(axis: FilterAxis, value: string) => applyFilters(toggleFilterValue(filters, axis, value)),
		[applyFilters, filters],
	);
	const onClearFilters = useCallback(() => applyFilters(DEFAULT_FILTERS), [applyFilters]);

	const entries = binder.data?.entries ?? NO_ENTRIES;
	// Memoised on the document and the selection, so a filter that has not changed does not walk
	// 817 entries because something else re-rendered.
	const visible = useMemo(() => filterEntries(entries, filters), [entries, filters]);
	const facets = useMemo(() => filterFacets(entries), [entries]);
	const extraFilters = extraFilterCount(filters);
	const neededOnly = filters.state.length === 1 && filters.state[0] === "needed";
	const englishOn = filters.language.includes(DEFAULT_LANGUAGE);

	const [filtersOpen, setFiltersOpen] = useState(false);
	const closeFilters = useCallback(() => setFiltersOpen(false), []);

	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [addingBlank, setAddingBlank] = useState(false);
	// Looked up in the whole document rather than the visible slice, so a sheet already open does
	// not vanish because the entry behind it stopped matching.
	const selected = useMemo(
		() => entries.find((entry) => entry.key === selectedKey) ?? null,
		[entries, selectedKey],
	);
	const closeSheet = useCallback(() => setSelectedKey(null), []);

	const onManualCreated = useCallback(
		(created: ManualVariantDocument) => {
			setAddingBlank(false);
			// Default language filter is EN. A Korean clone would otherwise land in the masterset
			// and vanish from the grid, which reads as "it didn't save".
			if (filters.language.length > 0 && !filters.language.includes(created.language)) {
				applyFilters({ ...filters, language: [...filters.language, created.language] });
			}
			setSelectedKey(binderEntryKey(created.cardKey, created.variantId));
		},
		[applyFilters, filters],
	);

	const scrollRef = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);
	useEffect(() => {
		const element = scrollRef.current;
		if (element === null) return;
		setWidth(element.clientWidth);
		const observer = new ResizeObserver(() => setWidth(element.clientWidth));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const metrics = useMemo(() => gridMetrics(width), [width]);
	const rowCount = Math.ceil(visible.length / metrics.columns);

	const virtualizer = useVirtualizer({
		count: rowCount,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => metrics.rowHeight,
		overscan: OVERSCAN_ROWS,
	});

	// Rotating the phone changes the column count, and with it the row height that `estimateSize`
	// closes over. The virtualizer memoises its measurements *without* `estimateSize` in the memo
	// key, so it never notices; the grid then draws itself on top of itself until the next
	// scroll. `measure()` is what discards that cache. Keyed on the width the row height is
	// derived from, and skipped until the container has reported one — before that the metrics
	// are a placeholder and measuring would only cache the placeholder.
	useEffect(() => {
		if (width === 0) return;
		virtualizer.measure();
	}, [virtualizer, width]);

	// A filter changes how many rows there are, and the scroller does not know that. Left alone,
	// narrowing 817 entries to 12 while scrolled 5,000px down leaves the owner staring at empty
	// canvas below the end of their own result. Back to the top, then discard the measurement
	// cache — the same fix rotation needed, for the same reason: the row count is not in the
	// virtualiser's memo key.
	//
	// Keyed on the *serialised* selection rather than the object, so this does not fire when the
	// sheet opens or the document refetches — dismissing a sheet must still return to the same
	// scroll offset, which is a criterion of the ticket this one builds on. And compared against
	// the last one applied rather than run on every mount: arriving on a bookmarked filtered URL
	// is not a filter *change*, and the scroller is already at the top there anyway.
	const filterKey = useMemo(() => JSON.stringify(searchFromFilters(filters)), [filters]);
	const appliedFilterKey = useRef(filterKey);
	useEffect(() => {
		if (appliedFilterKey.current === filterKey) return;
		appliedFilterKey.current = filterKey;

		const element = scrollRef.current;
		if (element === null) return;
		element.scrollTop = 0;
		virtualizer.measure();
	}, [filterKey, virtualizer]);

	return (
		<main className="binder">
			{/* Deliberately carries no counts, no percentage and no density map. The ticket rules
			    out an aggregate summary above the grid, and the spec rules out the density map
			    outright — the grid itself is how the collection is read. That rule is why the
			    filter row below says how many *axes* are narrowing the grid and never how many
			    cards came back: a count of needed cards is the completion figure in disguise. */}
			<div className="binder-bar">
				<span className="binder-wordmark">Gloom Watch</span>
				<span className="binder-links">
					<Link to="/feed" search={{ location: ["AU"] }} className="binder-link">
						feed
					</Link>
					<Link to="/status" className="binder-link">
						status
					</Link>
					<button
						type="button"
						className="binder-link binder-add"
						onClick={() => setAddingBlank(true)}
					>
						add
					</button>
				</span>
			</div>

			<div className="binder-filter-bar">
				<label className="binder-number-filter">
					<span className="binder-number-filter-label">No.</span>
					<input
						type="search"
						inputMode="search"
						enterKeyHint="search"
						autoComplete="off"
						autoCorrect="off"
						spellCheck={false}
						placeholder="198"
						value={filters.number}
						onChange={(event) => applyFilters(setFilterNumber(filters, event.target.value))}
						aria-label="Card number"
					/>
				</label>
				<button
					type="button"
					aria-pressed={englishOn}
					className={englishOn ? "filter-chip filter-chip-on" : "filter-chip"}
					onClick={() => onToggleFilter("language", DEFAULT_LANGUAGE)}
				>
					EN
				</button>
				{/* The Gap, one tap from the grid. It is the filter the whole screen exists to make
				    reachable, and burying it two taps deep inside the sheet would make "what I still
				    need" feel like a screen again. */}
				<button
					type="button"
					aria-pressed={neededOnly}
					className={neededOnly ? "filter-chip filter-chip-on" : "filter-chip"}
					onClick={() =>
						applyFilters(setFilterAxis(filters, "state", neededOnly ? [] : ["needed"]))
					}
				>
					needed
				</button>
				<button
					type="button"
					className="filter-chip"
					aria-expanded={filtersOpen}
					onClick={() => setFiltersOpen(true)}
				>
					filters{extraFilters > 0 ? ` · ${extraFilters}` : ""}
				</button>
				{extraFilters > 0 ? (
					<button type="button" className="filter-chip" onClick={onClearFilters}>
						clear
					</button>
				) : null}
			</div>

			<div className="binder-scroll" ref={scrollRef}>
				{binder.isPending ? (
					<p className="binder-note muted">
						{/* `fetchStatus` is "paused" when the client believes there is no connection and
						    the service worker had nothing cached. "Reading…" forever would be a lie. */}
						{binder.fetchStatus === "paused"
							? "No connection, and no cached copy of the masterset on this device yet."
							: "Reading the masterset…"}
					</p>
				) : null}
				{binder.isError ? (
					<p className="binder-note error">
						The server did not answer: {(binder.error as Error).message}
					</p>
				) : null}
				{binder.isSuccess && entries.length === 0 ? (
					<p className="binder-note muted">
						The masterset is empty. Sync the corpus from the <Link to="/status">status</Link>{" "}
						screen.
					</p>
				) : null}
				{entries.length > 0 && visible.length === 0 ? (
					<p className="binder-note muted">
						Nothing in the masterset matches these filters.{" "}
						<button type="button" className="linkish" onClick={onClearFilters}>
							Clear them
						</button>
						.
					</p>
				) : null}

				<div className="binder-canvas" style={{ height: virtualizer.getTotalSize() }}>
					{virtualizer.getVirtualItems().map((row) => {
						const start = row.index * metrics.columns;
						return (
							<div
								key={row.key}
								className="binder-row"
								style={{ height: row.size, transform: `translateY(${row.start}px)` }}
							>
								{visible.slice(start, start + metrics.columns).map((entry) => (
									// **Keyed on the composed `(card_key, variant_id)`, never on `variantId`.**
									// 264 different cards share one `variantId` in the live corpus; keyed on it
									// alone React would render 21 cells and drop 796 without an error anywhere.
									<BinderCell
										key={entry.key}
										entry={entry}
										metrics={metrics}
										onOpen={setSelectedKey}
									/>
								))}
							</div>
						);
					})}
				</div>
			</div>

			{filtersOpen ? (
				<FilterSheet
					facets={facets}
					filters={filters}
					onToggle={onToggleFilter}
					onClear={onClearFilters}
					onClose={closeFilters}
				/>
			) : null}

			{selected === null ? null : (
				<BinderSheet
					entry={selected}
					onClose={closeSheet}
					onCreated={onManualCreated}
					onDeleted={closeSheet}
				/>
			)}

			{addingBlank ? (
				<div className="sheet-layer">
					<div
						className="sheet-backdrop"
						onClick={() => setAddingBlank(false)}
						aria-hidden="true"
					/>
					<BlankManualEntry onCreated={onManualCreated} onCancel={() => setAddingBlank(false)} />
				</div>
			) : null}
		</main>
	);
}
