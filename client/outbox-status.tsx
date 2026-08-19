/**
 * The pending-write count, and the photograph hold, as the owner sees them.
 *
 * The spec puts the outbox pending count on the health surfaces as *client* state — the server
 * cannot know it. Photographs that were attempted offline sit beside it, never in the queue.
 */

import { useEffect, useState } from "react";
import { getDefaultOutboxStore, type OutboxStore } from "../shared/outbox.ts";

export interface OutboxSnapshot {
	readonly writes: number;
	readonly photos: number;
	readonly photoCopyIds: readonly (string | null)[];
	readonly lastError: string | null;
}

export function useOutboxSnapshot(store: OutboxStore = getDefaultOutboxStore()): OutboxSnapshot {
	const [snapshot, setSnapshot] = useState<OutboxSnapshot>({
		writes: 0,
		photos: 0,
		photoCopyIds: [],
		lastError: null,
	});

	useEffect(() => {
		let cancelled = false;
		const refresh = () => {
			void Promise.all([store.list(), store.photoHolds()]).then(([writes, photos]) => {
				if (cancelled) return;
				setSnapshot({
					writes: writes.length,
					photos: photos.length,
					photoCopyIds: photos.map((hold) => hold.copyId),
					lastError: writes.find((entry) => entry.lastError !== null)?.lastError ?? null,
				});
			});
		};
		refresh();
		const unsubscribe = store.subscribe(refresh);
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [store]);

	return snapshot;
}

export function outboxPendingLine(snapshot: OutboxSnapshot): string | null {
	const parts: string[] = [];
	if (snapshot.writes === 1) parts.push("1 write waiting to send");
	if (snapshot.writes > 1) parts.push(`${snapshot.writes} writes waiting to send`);
	if (snapshot.photos === 1) parts.push("1 photo waiting for a connection");
	if (snapshot.photos > 1) parts.push(`${snapshot.photos} photos waiting for a connection`);
	if (parts.length === 0) return null;
	return parts.join(" · ");
}

export function OutboxPendingNote({ store }: { store?: OutboxStore }) {
	const snapshot = useOutboxSnapshot(store);
	const line = outboxPendingLine(snapshot);
	if (line === null) return null;
	return (
		<p className="outbox-pending">
			{line}
			{snapshot.lastError === null ? null : (
				<span className="error"> — last send failed: {snapshot.lastError}</span>
			)}
		</p>
	);
}
