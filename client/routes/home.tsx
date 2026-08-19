import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ScanHealth } from "../../shared/listings.ts";
import { fetchCompletion, fetchHealth } from "../api.ts";
import { COMPLETION_QUERY_KEY } from "../collection.ts";
import { NotificationSection } from "../notifications.tsx";
import { useOutboxSnapshot } from "../outbox-status.tsx";
import { serviceWorkerScope } from "../pwa.ts";
import { CorpusPanel } from "./corpus.tsx";
import { OfflineImagesPanel } from "./offline-images.tsx";

/**
 * The status screen, at `/status`.
 *
 * This was the app's only screen through the walking skeleton, the push transport and the corpus
 * ingest. The binder took `/` when it landed, which is where it belongs — everything here is
 * something the owner consults when they want to know why the app is behaving oddly, not
 * something they open to look at the collection.
 *
 * Everything in the first block is read out of SQLite by the server and rendered here. The
 * masterset panel below it is the corpus surface: press sync, watch the job, read the variant
 * count and the last-synced time.
 */

function formatInstant(value: number | null, timezone: string): string {
	if (value === null) return "—";
	try {
		return new Intl.DateTimeFormat("en-AU", {
			dateStyle: "medium",
			timeStyle: "medium",
			timeZone: timezone,
		}).format(new Date(value));
	} catch {
		// An unrecognised IANA name should show the instant, not blow the page up.
		return new Date(value).toISOString();
	}
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="row">
			<dt>{label}</dt>
			<dd>{value}</dd>
		</div>
	);
}

/**
 * Completion — the two numbers, and **not** a presentation of them.
 *
 * The spec records how completion is presented numerically as **still open**, and the binder
 * ticket forbids an aggregate summary above the grid. So it is here, on the screen the owner
 * consults rather than the one they browse, as the numerator over the denominator exactly as the
 * spec defines them. No percentage, no bar, no ratio: each of those is a choice, and rounding
 * `312 / 817` to `38%` is a choice that throws away the only two numbers anybody has agreed on.
 *
 * The excluded count is shown because the denominator rule is invisible otherwise. A variant
 * flagged `missing_upstream` that the owner does not hold leaves the total, so the figure can move
 * without the owner touching anything, and that line is what makes the reason readable.
 */
function ScanPanel({
	scan,
	timezone,
	formatInstant,
}: {
	scan: ScanHealth | undefined;
	timezone: string;
	formatInstant: (value: number | null) => string;
}) {
	if (scan === undefined) return null;

	const oldestSuccess = scan.marketplaces.reduce<number | null>((oldest, entry) => {
		if (entry.lastSuccessAt === null) return oldest;
		if (oldest === null || entry.lastSuccessAt < oldest) return entry.lastSuccessAt;
		return oldest;
	}, null);

	return (
		<section>
			<h2>The scanner</h2>
			<p className="subtitle">
				<Link to="/feed" search={{ location: ["AU"] }}>
					open the feed
				</Link>
			</p>
			<dl>
				<Row label="Cycle" value={String(scan.cycle)} />
				<Row label="Calls today" value={`${scan.dailyCallsUsed} / ${scan.dailyCallBudget}`} />
				<Row
					label="Oldest success"
					value={
						oldestSuccess === null
							? "never — waiting on the first cycle"
							: formatInstant(oldestSuccess)
					}
				/>
				{scan.marketplaces.map((entry) => (
					<Row
						key={entry.marketplace}
						label={entry.marketplace}
						value={
							entry.lastSuccessAt === null
								? entry.consecutiveFailures > 0
									? `never · ${entry.consecutiveFailures} fail`
									: "not yet"
								: `${formatInstant(entry.lastSuccessAt)}${
										entry.consecutiveFailures > 0 ? ` · ${entry.consecutiveFailures} fail` : ""
									}`
						}
					/>
				))}
			</dl>
			<p className="muted">Times in {timezone}.</p>
		</section>
	);
}

function DeviceOutboxRows() {
	const snapshot = useOutboxSnapshot();
	return (
		<>
			<Row
				label="Outbox"
				value={
					snapshot.writes === 0
						? "clear"
						: snapshot.writes === 1
							? "1 write waiting"
							: `${snapshot.writes} writes waiting`
				}
			/>
			{snapshot.photos > 0 ? (
				<Row
					label="Photos held"
					value={
						snapshot.photos === 1
							? "1 — waiting for a connection"
							: `${snapshot.photos} — waiting for a connection`
					}
				/>
			) : null}
			{snapshot.lastError === null ? null : <Row label="Last send" value={snapshot.lastError} />}
		</>
	);
}

function CompletionPanel() {
	const completion = useQuery({
		queryKey: COMPLETION_QUERY_KEY,
		queryFn: ({ signal }) => fetchCompletion(signal),
	});

	return (
		<section>
			<h2>The collection</h2>
			{completion.isError ? (
				<p className="error">The server did not answer: {(completion.error as Error).message}</p>
			) : null}
			{completion.data ? (
				<dl>
					<Row
						label="Variants owned"
						value={`${completion.data.owned} / ${completion.data.total}`}
					/>
					{completion.data.missingUpstreamExcluded > 0 ? (
						// The explanation belongs in the value, not the label. `dt` is `white-space:
						// nowrap`, so a long label cannot wrap and pushes the row past the viewport —
						// at 390 points this line overflowed horizontally, which the binder's own rule
						// forbids. `dd` wraps, so the reason survives at the width it has to survive at.
						<Row
							label="Left out"
							value={`${completion.data.missingUpstreamExcluded} — missing upstream, unowned`}
						/>
					) : null}
				</dl>
			) : (
				<p className="muted">Reading…</p>
			)}
		</section>
	);
}

export function HomeScreen() {
	const health = useQuery({
		queryKey: ["health"],
		queryFn: ({ signal }) => fetchHealth(signal),
		refetchInterval: 30_000,
	});

	const [scope, setScope] = useState<string | null>(null);
	useEffect(() => {
		let cancelled = false;
		void serviceWorkerScope().then((value) => {
			if (!cancelled) setScope(value);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<main>
			<header>
				<h1>Gloom Watch</h1>
				<p className="subtitle">Masterset tracker — Oddish, Gloom, Vileplume, Bellossom</p>
				<p className="subtitle">
					<Link to="/">← the binder</Link>
				</p>
			</header>

			<section>
				<h2>From the database</h2>
				{health.isPending ? <p className="muted">Reading…</p> : null}
				{health.isError ? (
					<p className="error">The server did not answer: {(health.error as Error).message}</p>
				) : null}
				{health.data ? (
					<dl>
						<Row label="Timezone" value={health.data.timezone} />
						<Row
							label="Installed"
							value={formatInstant(health.data.installedAt, health.data.timezone)}
						/>
						<Row
							label="Last cron heartbeat"
							value={
								health.data.lastHeartbeatAt === null
									? "never — the OS-level job has not run"
									: formatInstant(health.data.lastHeartbeatAt, health.data.timezone)
							}
						/>
						<Row label="Migrations applied" value={String(health.data.migrationsApplied)} />
						<Row
							label="Server clock"
							value={formatInstant(health.data.serverTimeMs, health.data.timezone)}
						/>
					</dl>
				) : null}
			</section>

			<ScanPanel
				scan={health.data?.scan}
				timezone={health.data?.timezone ?? "UTC"}
				formatInstant={(value) => formatInstant(value, health.data?.timezone ?? "UTC")}
			/>

			<CompletionPanel />

			<CorpusPanel
				formatInstant={(value) => formatInstant(value, health.data?.timezone ?? "UTC")}
			/>

			<OfflineImagesPanel />

			<section>
				<h2>On this device</h2>
				<dl>
					<DeviceOutboxRows />
					<Row label="Service worker scope" value={scope ?? "not registered"} />
				</dl>
			</section>

			<NotificationSection />

			<footer>
				<p className="muted">
					The values above travelled from SQLite, through Hono, to this screen. The masterset is
					pulled from TCGdex on demand; the corpus never refreshes itself.
				</p>
			</footer>
		</main>
	);
}
