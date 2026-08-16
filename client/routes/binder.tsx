import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BinderEntry } from "../../shared/contract.ts";
import { corpusCardImagePath } from "../../shared/contract.ts";
import { fetchBinder } from "../api.ts";
import { CopiesPanel } from "../binder/copies-panel.tsx";
import {
	axisRows,
	cellPresentation,
	ownershipLine,
	setLine,
	variantBadge,
} from "../binder/presentation.ts";
import { BINDER_QUERY_KEY } from "../collection.ts";

/**
 * The binder — the app's primary surface, and the screen the whole design is built around.
 *
 * Three properties are load-bearing and each is visible in the code below:
 *
 * **One document.** The whole masterset arrives in a single request and lives in one query. It
 * is never paged and never re-fetched per cell, which is what lets the service worker hold the
 * binder for offline browsing and what will let the next-but-one ticket filter it client-side.
 *
 * **Virtualised.** ~765 cells is more than a phone will paint at sixty frames a second. Only the
 * rows in view exist in the DOM; the rest are height. The virtualiser works in *rows* rather
 * than cells — one measurement axis instead of two, and the column count is a pure function of
 * the container's width, so a rotation re-lays-out without a second virtualiser to keep in sync.
 *
 * **The sheet is not a route.** Tapping a card sets a piece of component state. The grid is not
 * unmounted, the URL does not move, no navigation happens — so dismissing the sheet returns to
 * the same scroll offset because the scroll container was never touched. Making it a route would
 * mean re-mounting the scroller and losing the position, which is exactly the thing the spec
 * says the binder must not do.
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
function BinderSheet({ entry, onClose }: { entry: BinderEntry; onClose: () => void }) {
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
					</dl>
				</div>

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
	const binder = useQuery({
		queryKey: BINDER_QUERY_KEY,
		queryFn: ({ signal }) => fetchBinder(signal),
		// The corpus changes only when the owner presses sync, and copies only when the owner
		// records one. Polling a 200 KB document on a timer would burn battery to learn nothing.
		staleTime: 60_000,
	});

	const entries = binder.data?.entries ?? NO_ENTRIES;
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const selected = useMemo(
		() => entries.find((entry) => entry.key === selectedKey) ?? null,
		[entries, selectedKey],
	);
	const closeSheet = useCallback(() => setSelectedKey(null), []);

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
	const rowCount = Math.ceil(entries.length / metrics.columns);

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

	return (
		<main className="binder">
			{/* Deliberately carries no counts, no percentage and no density map. The ticket rules
			    out an aggregate summary above the grid, and the spec rules out the density map
			    outright — the grid itself is how the collection is read. */}
			<div className="binder-bar">
				<span className="binder-wordmark">Gloom Watch</span>
				<Link to="/status" className="binder-link">
					status
				</Link>
			</div>

			<div className="binder-scroll" ref={scrollRef}>
				{binder.isPending ? <p className="binder-note muted">Reading the masterset…</p> : null}
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

				<div className="binder-canvas" style={{ height: virtualizer.getTotalSize() }}>
					{virtualizer.getVirtualItems().map((row) => {
						const start = row.index * metrics.columns;
						return (
							<div
								key={row.key}
								className="binder-row"
								style={{ height: row.size, transform: `translateY(${row.start}px)` }}
							>
								{entries.slice(start, start + metrics.columns).map((entry) => (
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

			{selected === null ? null : <BinderSheet entry={selected} onClose={closeSheet} />}
		</main>
	);
}
