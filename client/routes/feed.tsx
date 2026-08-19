import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { ListingDocument } from "../../shared/listings.ts";
import { describeResolution } from "../../shared/matcher.ts";
import { formatMoney } from "../../shared/money.ts";
import { fetchHealth, fetchListing, fetchListings } from "../api.ts";
import { searchFromFeed, toggleLocation } from "../feed-filters.ts";

/**
 * The listing feed. Each card shows the matcher's grain so a card-grain result is visible
 * rather than looking like a variant the owner does not actually have.
 *
 * Prices older than six hours are omitted by the server and the age is a sentence, not a
 * timestamp — eBay's display-freshness term requires the disclosure, and hiding the price
 * in CSS while leaving it in the JSON would still be displaying it.
 */

function formatSeenAt(observedAt: number, timezone: string): string {
	try {
		return new Intl.DateTimeFormat("en-AU", {
			dateStyle: "medium",
			timeStyle: "short",
			timeZone: timezone,
		}).format(new Date(observedAt));
	} catch {
		return new Date(observedAt).toISOString();
	}
}

function ListingPrice({ listing }: { listing: ListingDocument }) {
	if (listing.priceHidden) {
		return <span className="muted">price hidden — {listing.ageDisclosed}</span>;
	}
	if (listing.priceMinor === null || listing.currency === null) {
		return <span className="muted">no price</span>;
	}
	return <span>{formatMoney(listing.priceMinor, listing.currency)}</span>;
}

function ListingCard({ listing, timezone }: { listing: ListingDocument; timezone: string }) {
	return (
		<article className="listing-card">
			<h3>
				<Link to="/feed/$itemId" params={{ itemId: listing.itemId }}>
					{listing.title || listing.itemId}
				</Link>
			</h3>
			<p className="listing-meta">
				<ListingPrice listing={listing} />
				{listing.priceHidden ? null : <span className="muted"> · {listing.ageDisclosed}</span>}
			</p>
			<p className="listing-meta muted">
				seen {formatSeenAt(listing.observedAt, timezone)}
				{listing.itemLocationCountry !== null ? ` · ${listing.itemLocationCountry}` : ""}
			</p>
			<p className={`listing-match listing-match-${listing.match.grain}`}>
				{describeResolution(listing.match)}
			</p>
			{listing.itemWebUrl !== null ? (
				<p className="listing-meta">
					<a href={listing.itemWebUrl} target="_blank" rel="noreferrer">
						open on eBay
					</a>
				</p>
			) : null}
		</article>
	);
}

export function FeedScreen() {
	const navigate = useNavigate({ from: "/feed" });
	const filters = useSearch({ from: "/feed" });
	const health = useQuery({
		queryKey: ["health"],
		queryFn: ({ signal }) => fetchHealth(signal),
	});
	const feed = useQuery({
		queryKey: ["listings", filters.location],
		queryFn: ({ signal }) => fetchListings(signal, { locations: filters.location }),
		refetchInterval: 60_000,
	});

	const timezone = health.data?.timezone ?? "UTC";

	return (
		<main>
			<header>
				<h1>Listings</h1>
				<p className="subtitle">Newly seen Oddish-line cards, as the scanner finds them</p>
				<p className="subtitle">
					<Link to="/">← the binder</Link>
					{" · "}
					<Link to="/queue">queue</Link>
					{" · "}
					<Link to="/status">status</Link>
				</p>
			</header>

			<div className="filter-chips" style={{ marginTop: "1rem" }}>
				{(feed.data?.locations ?? []).map((facet) => {
					const on = filters.location.includes(facet.country);
					return (
						<button
							key={facet.country}
							type="button"
							aria-pressed={on}
							className={on ? "filter-chip filter-chip-on" : "filter-chip"}
							onClick={() =>
								void navigate({
									search: searchFromFeed(toggleLocation(filters, facet.country)),
								})
							}
						>
							{facet.country}
							<span className="muted"> {facet.count}</span>
						</button>
					);
				})}
			</div>

			{feed.isPending ? <p className="muted">Reading…</p> : null}
			{feed.isError ? (
				<p className="error">The server did not answer: {(feed.error as Error).message}</p>
			) : null}
			{feed.data?.listings.length === 0 ? (
				<p className="muted">
					{filters.location.length > 0
						? "Nothing in those locations yet."
						: "Nothing seen yet. The scanner runs every ten minutes once eBay credentials are configured."}
				</p>
			) : null}
			{feed.data?.listings.map((listing) => (
				<ListingCard key={listing.itemId} listing={listing} timezone={timezone} />
			))}
		</main>
	);
}

export function ListingDetailScreen() {
	const { itemId } = useParams({ from: "/feed/$itemId" });
	const health = useQuery({
		queryKey: ["health"],
		queryFn: ({ signal }) => fetchHealth(signal),
	});
	const listing = useQuery({
		queryKey: ["listing", itemId],
		queryFn: ({ signal }) => fetchListing(itemId, signal),
	});

	const timezone = health.data?.timezone ?? "UTC";

	return (
		<main>
			<header>
				<h1>Listing</h1>
				<p className="subtitle">
					<Link to="/feed" search={{ location: ["AU"] }}>
						← the feed
					</Link>
				</p>
			</header>

			{listing.isPending ? <p className="muted">Reading…</p> : null}
			{listing.isError ? (
				<p className="error">That listing is not here: {(listing.error as Error).message}</p>
			) : null}
			{listing.data ? (
				<>
					<ListingCard listing={listing.data} timezone={timezone} />
					<p className="muted">
						eBay listings older than six hours cannot be shown as current. This one is{" "}
						{listing.data.ageDisclosed}.
					</p>
				</>
			) : null}
		</main>
	);
}
