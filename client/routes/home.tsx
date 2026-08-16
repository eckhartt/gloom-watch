import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchHealth } from "../api.ts";
import { NotificationSection } from "../notifications.tsx";
import { serviceWorkerScope } from "../pwa.ts";
import { CorpusPanel } from "./corpus.tsx";

/**
 * The Home Screen.
 *
 * Everything in the first block is read out of SQLite by the server and rendered here. The
 * masterset panel below it is the corpus surface: press sync, watch the job, read the variant
 * count and the last-synced time. The binder view replaces this screen in a later ticket.
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

			<CorpusPanel
				formatInstant={(value) => formatInstant(value, health.data?.timezone ?? "UTC")}
			/>

			<section>
				<h2>On this device</h2>
				<dl>
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
