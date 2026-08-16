/**
 * The filter sheet: one section per axis, one chip per value.
 *
 * **It is component state, not a route**, for the same reason the variant sheet is. Opening the
 * filters must not unmount the grid or move the scroll position — and the Gap being a filter
 * rather than a screen is a ruling this file would quietly break by becoming a page.
 *
 * Sections are always expanded rather than collapsible. Seven of the eight axes offer thirty-odd
 * chips between them, which is a few taps of scrolling; a disclosure widget per axis would be
 * more state to keep right than it saves. `set` is last because it is the long one.
 *
 * There are **no counts on the chips**. A tally of needed cards is the completion figure wearing
 * a different hat, and how completion is presented numerically is still open in the spec.
 */

import { useEffect } from "react";
import type { BinderFilters, FilterAxis, FilterFacets, FilterOption } from "./filters.ts";
import { activeFilterCount, FILTER_AXES } from "./filters.ts";

const AXIS_TITLES: Readonly<Record<FilterAxis, string>> = {
	state: "Owned / needed",
	priority: "Priority",
	language: "Language",
	finish: "Finish",
	subtype: "Subtype",
	stamps: "Stamps",
	foil: "Foil",
	set: "Set",
};

function Chip({
	option,
	selected,
	onToggle,
}: {
	option: FilterOption;
	selected: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			// `aria-pressed` rather than a checkbox: it is a toggle, and this is how a toggle is
			// announced. The class is what carries the same fact to anyone who can see it.
			aria-pressed={selected}
			className={selected ? "filter-chip filter-chip-on" : "filter-chip"}
			onClick={onToggle}
		>
			{option.label}
		</button>
	);
}

export function FilterSheet({
	facets,
	filters,
	onToggle,
	onClear,
	onClose,
}: {
	facets: FilterFacets;
	filters: BinderFilters;
	onToggle: (axis: FilterAxis, value: string) => void;
	onClear: () => void;
	onClose: () => void;
}) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	const active = activeFilterCount(filters);

	return (
		<div className="sheet-layer">
			<div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
			<section className="sheet" role="dialog" aria-modal="true" aria-label="Filter the binder">
				<header className="sheet-head">
					<div>
						<h2 className="sheet-name">Filters</h2>
						<p className="sheet-set">
							{/* The rule, said once, where somebody choosing two values can read it. Two
							    values on one axis widen the result; two axes narrow it. */}
							Several values on one axis show any of them. Different axes must all match.
						</p>
					</div>
					<button type="button" className="quiet" onClick={onClose}>
						Close
					</button>
				</header>

				<div className="filter-sections">
					{FILTER_AXES.map((axis) => {
						const options = facets[axis];
						// An axis the masterset carries no value for is not offered. An empty section is
						// an invitation to wonder whether the filter is broken.
						if (options.length === 0) return null;

						return (
							<div className="filter-section" key={axis}>
								<h3>{AXIS_TITLES[axis]}</h3>
								<div className="filter-chips">
									{options.map((option) => (
										<Chip
											key={option.value}
											option={option}
											selected={filters[axis].includes(option.value)}
											onToggle={() => onToggle(axis, option.value)}
										/>
									))}
								</div>
							</div>
						);
					})}
				</div>

				<div className="actions">
					<button type="button" className="quiet" onClick={onClear} disabled={active === 0}>
						Clear all
					</button>
				</div>
			</section>
		</div>
	);
}
