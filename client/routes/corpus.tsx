import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CorpusStatusDocument, CorpusSyncJobDocument } from "../../shared/contract.ts";
import {
	deleteExclusion,
	fetchCorpusStatus,
	fetchExclusions,
	startCorpusSync,
	upsertExclusion,
} from "../api.ts";
import { CORPUS_STATUS_QUERY_KEY, EXCLUSIONS_QUERY_KEY, invalidateAfter } from "../collection.ts";

/**
 * The corpus panel: press sync, watch it run, read the variant count and the last-synced time.
 *
 * Sync is a job, so this never waits on a request. The button starts it and the panel polls the
 * status document — which is also what makes progress visible when the app is reopened halfway
 * through a sync, or on a second device.
 *
 * The refresh cadence is the only client-side cleverness here: two seconds while a job is
 * running, thirty when it is not.
 */

const PHASE_LABELS: Record<string, string> = {
	languages: "deriving the language list",
	brief: "reading the card lists",
	detail: "reading card detail",
	sets: "reading set release dates",
	images: "downloading images",
	reconcile: "reconciling",
	done: "done",
};

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "alarm" }) {
	return (
		<div className="row">
			<dt>{label}</dt>
			<dd className={tone === "alarm" ? "alarm" : undefined}>{value}</dd>
		</div>
	);
}

function progressOf(job: CorpusSyncJobDocument): string {
	const phase = PHASE_LABELS[job.phase] ?? job.phase;
	if (job.total === null || job.total === 0) return phase;
	return `${phase} — ${job.processed} / ${job.total}`;
}

/**
 * **Do not report a delta in a list of totals.**
 *
 * This line read `497 card(s), 817 variant(s), 0 image(s)` after a no-op re-sync, because
 * `imagesFetched` counts what was *downloaded* and every hash still matched the manifest. Two
 * totals followed by a delta reads as three totals, and the owner reasonably took it to mean the
 * corpus had lost its images. A sync that reports zero of something is exactly when a reader
 * starts looking for data loss, so the number next to "images" has to be how many there are.
 */
export function jobSummary(job: CorpusSyncJobDocument): string {
	if (job.status === "running") return progressOf(job);
	if (job.status === "interrupted") return "interrupted by a restart";
	if (job.status === "failed") return job.error ?? "failed";

	const images = job.imagesFetched + job.imagesUnchanged;
	const fetched =
		job.imagesFetched === 0 ? "none newly fetched" : `${job.imagesFetched} newly fetched`;

	return (
		`${job.cardsUpserted} card(s), ${job.variantsUpserted} variant(s), ` +
		`${images} image(s) — ${fetched}` +
		(job.variantsFlaggedMissing > 0 ? `, ${job.variantsFlaggedMissing} flagged missing` : "")
	);
}

export function CorpusPanel({
	formatInstant,
}: {
	formatInstant: (value: number | null) => string;
}) {
	const queryClient = useQueryClient();

	const status = useQuery({
		queryKey: CORPUS_STATUS_QUERY_KEY,
		queryFn: ({ signal }) => fetchCorpusStatus(signal),
		refetchInterval: (query) => {
			const data = query.state.data as CorpusStatusDocument | undefined;
			return data?.syncRunning ? 2_000 : 30_000;
		},
	});

	const sync = useMutation({
		mutationFn: startCorpusSync,
		// A sync moves the **denominator**: a new language or a new printing makes the masterset
		// bigger and completion goes down, which is correct for a masterset and exactly the number a
		// client holding yesterday's figure would get wrong.
		onSuccess: () => invalidateAfter(queryClient, "corpus-sync"),
	});

	const data = status.data;
	const job = data?.latestJob ?? null;
	const running = data?.syncRunning ?? false;

	return (
		<section>
			<h2>The masterset</h2>
			{status.isError ? (
				<p className="error">The server did not answer: {(status.error as Error).message}</p>
			) : null}
			{data ? (
				<dl>
					<Row label="Variants" value={String(data.variants)} />
					<Row label="Cards" value={String(data.cards)} />
					<Row label="Languages" value={String(data.languages)} />
					<Row label="Sets" value={String(data.sets)} />
					{data.setsWithoutReleaseDate > 0 ? (
						// The binder orders on the release date and puts undated sets last. A number
						// here climbing is the only warning that the default order has stopped meaning
						// what it says for part of the collection.
						<Row
							label="Sets with no release date"
							value={String(data.setsWithoutReleaseDate)}
							tone="alarm"
						/>
					) : null}
					<Row label="Images" value={`${data.imagesStored} — ${formatBytes(data.imageBytes)}`} />
					{data.variantsMissingUpstream > 0 ? (
						<Row
							label="Flagged missing upstream"
							value={String(data.variantsMissingUpstream)}
							tone="alarm"
						/>
					) : null}
					<Row
						label="Last synced"
						value={data.lastSyncedAt === null ? "never" : formatInstant(data.lastSyncedAt)}
					/>
					{data.variantCountDropped ? (
						// The masterset only grows unless something went wrong. Completion has no
						// oracle, so a shrinking count is the only warning a regression will ever give.
						<Row
							label="Warning"
							value="the variant count went down on the last sync"
							tone="alarm"
						/>
					) : null}
				</dl>
			) : (
				<p className="muted">Reading…</p>
			)}

			<div className="actions">
				<button type="button" onClick={() => sync.mutate()} disabled={running || sync.isPending}>
					{running ? "Syncing…" : "Sync corpus"}
				</button>
				{job !== null ? (
					<p className="muted">
						{running ? "" : `${job.status}: `}
						{jobSummary(job)}
					</p>
				) : null}
				{sync.isError ? <p className="error">{(sync.error as Error).message}</p> : null}
			</div>

			{job !== null && job.unknownAxisValues.length > 0 ? (
				<p className="muted">
					Unrecognised axis values, kept as-is:{" "}
					{job.unknownAxisValues.map((v) => `${v.axis}=${v.raw}`).join(", ")}
				</p>
			) : null}

			<ExclusionList />
		</section>
	);
}

/**
 * The name-sweep false-positive list. Applied on ingest, never written by a sync, which is why
 * it is owner-facing data on this screen rather than something a re-import could reconstruct.
 */
function ExclusionList() {
	const queryClient = useQueryClient();
	const [cardKey, setCardKey] = useState("");
	const [reason, setReason] = useState("");

	const list = useQuery({
		queryKey: EXCLUSIONS_QUERY_KEY,
		queryFn: ({ signal }) => fetchExclusions(signal),
	});

	const add = useMutation({
		mutationFn: upsertExclusion,
		onSuccess: () => {
			invalidateAfter(queryClient, "manual-write");
			setCardKey("");
			setReason("");
		},
	});

	const remove = useMutation({
		mutationFn: deleteExclusion,
		onSuccess: () => invalidateAfter(queryClient, "manual-write"),
	});

	return (
		<div className="exclusion-list">
			<h3>Exclusion list</h3>
			<p className="muted">
				Cards the name sweep would pull in that are not in the line. Applied on the next sync; a
				re-import never touches this list.
			</p>
			{list.isError ? (
				<p className="error">The exclusions did not load: {(list.error as Error).message}</p>
			) : null}
			{list.data !== undefined && list.data.length === 0 ? (
				<p className="muted">None yet.</p>
			) : null}
			{list.data !== undefined && list.data.length > 0 ? (
				<ul className="copy-list">
					{list.data.map((row) => (
						<li key={row.cardKey} className="copy">
							<div className="copy-lines">
								<span className="copy-headline">{row.cardKey}</span>
								{row.reason === null ? null : <span className="muted">{row.reason}</span>}
							</div>
							<div className="copy-buttons">
								<button
									type="button"
									className="quiet"
									onClick={() => remove.mutate(row.cardKey)}
									disabled={remove.isPending}
								>
									Remove
								</button>
							</div>
						</li>
					))}
				</ul>
			) : null}
			<form
				className="copy-form"
				onSubmit={(event) => {
					event.preventDefault();
					if (cardKey.trim() === "") return;
					add.mutate({
						cardKey: cardKey.trim(),
						reason: reason.trim() === "" ? null : reason.trim(),
					});
				}}
			>
				<div className="copy-field">
					<label htmlFor="exclusion-key">Card key</label>
					<input
						id="exclusion-key"
						value={cardKey}
						onChange={(e) => setCardKey(e.target.value)}
						placeholder="en:base1-45"
						autoComplete="off"
						spellCheck={false}
					/>
				</div>
				<div className="copy-field">
					<label htmlFor="exclusion-reason">Reason</label>
					<input
						id="exclusion-reason"
						value={reason}
						onChange={(e) => setReason(e.target.value)}
						placeholder="name-sweep false positive"
					/>
				</div>
				<div className="actions">
					<button type="submit" disabled={add.isPending || cardKey.trim() === ""}>
						Exclude
					</button>
				</div>
			</form>
			{add.error === null ? null : <p className="error">{add.error.message}</p>}
			{remove.error === null ? null : <p className="error">{remove.error.message}</p>}
		</div>
	);
}
