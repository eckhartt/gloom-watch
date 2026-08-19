import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { describeResolution } from "../../shared/matcher.ts";
import type { QueueCandidate, QueueItem } from "../../shared/queue.ts";
import {
	confirmQueuedListing,
	deleteAlias,
	fetchAliases,
	fetchQueue,
	pickQueuedVariant,
	rejectQueuedListing,
	updateAlias,
} from "../api.ts";

const QUEUE_KEY = ["queue"] as const;
const ALIASES_KEY = ["aliases"] as const;
const HEALTH_KEY = ["health"] as const;

function mintId(): string {
	return crypto.randomUUID();
}

function CandidateTile({
	candidate,
	onPick,
	busy,
}: {
	candidate: QueueCandidate;
	onPick: () => void;
	busy: boolean;
}) {
	const axes = [
		candidate.finish,
		candidate.subtype,
		...candidate.stamps,
		candidate.foil,
		candidate.size,
	].filter((value): value is string => value !== null && value !== "");
	return (
		<button type="button" className="queue-candidate" disabled={busy} onClick={onPick}>
			<strong>{candidate.variantId}</strong>
			<span className="muted">{axes.length > 0 ? axes.join(" · ") : "no axes"}</span>
			<span className={candidate.ownedCopies > 0 ? "queue-owned" : "queue-needed"}>
				{candidate.ownedCopies > 0 ? `owned ×${candidate.ownedCopies}` : "needed"}
			</span>
		</button>
	);
}

function QueueCard({
	item,
	busy,
	onBusy,
}: {
	item: QueueItem;
	busy: boolean;
	onBusy: (v: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const [phrase, setPhrase] = useState(item.listing.title);
	const [cardKey, setCardKey] = useState(item.match.cardKey ?? "");
	const [error, setError] = useState<string | null>(null);

	const invalidate = async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: QUEUE_KEY }),
			queryClient.invalidateQueries({ queryKey: ALIASES_KEY }),
			queryClient.invalidateQueries({ queryKey: HEALTH_KEY }),
			queryClient.invalidateQueries({ queryKey: ["listings"] }),
		]);
	};

	const run = async (work: () => Promise<unknown>) => {
		onBusy(true);
		setError(null);
		try {
			await work();
			await invalidate();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "that did not work");
		} finally {
			onBusy(false);
		}
	};

	const grainNone = item.match.grain === "none";
	const candidates = item.candidates ?? [];

	return (
		<article className="listing-card">
			<h3>{item.listing.title || item.listing.itemId}</h3>
			<p className={`listing-match listing-match-${item.match.grain}`}>
				{describeResolution(item.match)}
			</p>
			<label className="queue-field">
				phrase
				<input value={phrase} onChange={(event) => setPhrase(event.target.value)} disabled={busy} />
			</label>
			{grainNone ? (
				<label className="queue-field">
					card key
					<input
						value={cardKey}
						onChange={(event) => setCardKey(event.target.value)}
						placeholder="ja:SV3-002"
						disabled={busy}
					/>
				</label>
			) : null}

			{candidates.length > 0 ? (
				<div className="queue-candidates">
					{candidates.map((candidate) => (
						<CandidateTile
							key={`${candidate.cardKey} ${candidate.variantId}`}
							candidate={candidate}
							busy={busy}
							onPick={() =>
								void run(() =>
									pickQueuedVariant(item.listing.itemId, {
										variantId: candidate.variantId,
										phrase,
										aliasId: mintId(),
									}),
								)
							}
						/>
					))}
				</div>
			) : null}

			<div className="queue-actions">
				<button
					type="button"
					disabled={busy || (grainNone && cardKey.trim() === "")}
					onClick={() =>
						void run(() =>
							confirmQueuedListing(item.listing.itemId, {
								phrase,
								aliasId: mintId(),
								...(grainNone ? { cardKey: cardKey.trim() } : {}),
							}),
						)
					}
				>
					confirm
				</button>
				<button
					type="button"
					className="danger"
					disabled={busy}
					onClick={() => void run(() => rejectQueuedListing(item.listing.itemId))}
				>
					not a match
				</button>
			</div>
			{error !== null ? <p className="error">{error}</p> : null}
		</article>
	);
}

function AliasesPanel() {
	const queryClient = useQueryClient();
	const aliases = useQuery({
		queryKey: ALIASES_KEY,
		queryFn: ({ signal }) => fetchAliases(signal),
	});
	const [editing, setEditing] = useState<string | null>(null);
	const [phrase, setPhrase] = useState("");
	const [error, setError] = useState<string | null>(null);

	const save = useMutation({
		mutationFn: ({ id, next }: { id: string; next: string }) => updateAlias(id, { phrase: next }),
		onSuccess: async () => {
			setEditing(null);
			await queryClient.invalidateQueries({ queryKey: ALIASES_KEY });
			await queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
		},
		onError: (cause) => {
			setError(cause instanceof Error ? cause.message : "could not save");
		},
	});

	const remove = useMutation({
		mutationFn: (id: string) => deleteAlias(id),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ALIASES_KEY });
			await queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
		},
		onError: (cause) => {
			setError(cause instanceof Error ? cause.message : "could not delete");
		},
	});

	return (
		<section>
			<h2>Aliases</h2>
			<p className="subtitle">Owner-authored. Editable and deletable.</p>
			{aliases.isPending ? <p className="muted">Reading…</p> : null}
			{aliases.data?.aliases.length === 0 ? <p className="muted">None taught yet.</p> : null}
			{error !== null ? <p className="error">{error}</p> : null}
			<ul className="alias-list">
				{(aliases.data?.aliases ?? []).map((alias) => (
					<li key={alias.id} className="alias-row">
						{editing === alias.id ? (
							<>
								<input
									value={phrase}
									onChange={(event) => setPhrase(event.target.value)}
									aria-label="phrase"
								/>
								<button type="button" onClick={() => save.mutate({ id: alias.id, next: phrase })}>
									save
								</button>
								<button type="button" onClick={() => setEditing(null)}>
									cancel
								</button>
							</>
						) : (
							<>
								<span>
									<strong>{alias.phrase}</strong>
									<span className="muted">
										{" "}
										→ {alias.cardKey}
										{alias.variantId !== null ? ` / ${alias.variantId}` : ""}
									</span>
								</span>
								<button
									type="button"
									onClick={() => {
										setPhrase(alias.phrase);
										setEditing(alias.id);
									}}
								>
									edit
								</button>
								<button type="button" className="danger" onClick={() => remove.mutate(alias.id)}>
									delete
								</button>
							</>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}

export function QueueScreen() {
	const queue = useQuery({
		queryKey: QUEUE_KEY,
		queryFn: ({ signal }) => fetchQueue(signal),
		refetchInterval: 30_000,
	});
	const [busyId, setBusyId] = useState<string | null>(null);

	return (
		<main>
			<header>
				<h1>Confirm queue</h1>
				<p className="subtitle">Listings the matcher would not place. Depth is a health signal.</p>
				<p className="subtitle">
					<Link to="/">← the binder</Link>
					{" · "}
					<Link to="/feed" search={{ location: ["AU"] }}>
						feed
					</Link>
					{" · "}
					<Link to="/status">status</Link>
				</p>
			</header>

			<p>
				Queue depth <strong>{queue.data?.depth ?? "—"}</strong>
			</p>

			{queue.isPending ? <p className="muted">Reading…</p> : null}
			{queue.isError ? (
				<p className="error">The server did not answer: {(queue.error as Error).message}</p>
			) : null}
			{queue.data?.listings.length === 0 ? (
				<p className="muted">Nothing waiting. New listings land here when the matcher is unsure.</p>
			) : null}

			{queue.data?.listings.map((item) => (
				<QueueCard
					key={item.listing.itemId}
					item={item}
					busy={busyId === item.listing.itemId}
					onBusy={(busy) => setBusyId(busy ? item.listing.itemId : null)}
				/>
			))}

			<AliasesPanel />
		</main>
	);
}
