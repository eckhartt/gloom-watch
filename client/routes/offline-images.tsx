/**
 * The offline-images panel: the button that warms the card art, and the progress it reports.
 *
 * **It lives on `/status`, beside the corpus sync, because it is the same kind of thing** — a
 * long-running maintenance job the owner starts deliberately and then watches. The binder itself
 * stays free of chrome.
 *
 * **Nothing here starts on its own.** There is no effect in this file, and that is a property a
 * test asserts rather than a habit: a warm that began on mount would move ~26 MiB the moment the
 * owner opened the status screen on mobile data.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import type { WarmProgress } from "../binder/image-warm.ts";
import {
	imageWarmTargets,
	openCorpusImageCache,
	warmCorpusImages,
	warmSummary,
} from "../binder/image-warm.ts";
import { binderQueryOptions } from "../collection.ts";

function emptyProgress(total: number): WarmProgress {
	return { total, done: 0, fetched: 0, alreadyCached: 0, failed: 0, bytesFetched: 0 };
}

export function OfflineImagesPanel() {
	// The same query the binder uses, so opening this screen after browsing costs nothing: the
	// document is already in the cache and the warm reads its target list straight off it.
	const binder = useQuery(binderQueryOptions());

	const [progress, setProgress] = useState<WarmProgress | null>(null);
	const [running, setRunning] = useState(false);
	const [note, setNote] = useState<string | null>(null);
	const abort = useRef<AbortController | null>(null);

	const targets = useMemo(() => imageWarmTargets(binder.data?.entries ?? []), [binder.data]);

	async function start(): Promise<void> {
		setNote(null);

		const cache = await openCorpusImageCache();
		if (cache === null) {
			// Cache Storage needs a secure context. Plain HTTP to the box's LAN address is not one,
			// and that is a real way to open this app while debugging.
			setNote("Cache Storage is not available here — open the app over HTTPS.");
			return;
		}

		const controller = new AbortController();
		abort.current = controller;
		setRunning(true);
		setProgress(emptyProgress(targets.length));

		try {
			const final = await warmCorpusImages(targets, {
				cache,
				fetch: (url) => fetch(url),
				onProgress: setProgress,
				signal: controller.signal,
			});
			setProgress(final);
			if (controller.signal.aborted) {
				setNote("Stopped. Everything fetched before that is cached and stays cached.");
			}
		} catch (error) {
			setNote((error as Error).message);
		} finally {
			setRunning(false);
			abort.current = null;
		}
	}

	return (
		<section>
			<h2>Offline images</h2>
			<p className="muted">
				Fetches every card image the masterset holds into the cache the binder reads from with no
				connection. About 26 MB over the tailnet on a cold cache; an image already there costs
				nothing. Run it before a card fair or a flight — it never runs on its own.
			</p>

			<div className="actions">
				<button
					type="button"
					onClick={() => {
						void start();
					}}
					disabled={running || targets.length === 0}
				>
					{running ? "Warming…" : "Warm the image cache"}
				</button>
				{running ? (
					<button type="button" className="quiet" onClick={() => abort.current?.abort()}>
						Stop
					</button>
				) : null}
				{progress === null ? (
					<p className="muted">
						{targets.length === 0
							? "Waiting for the masterset."
							: `${targets.length} image(s) in the masterset.`}
					</p>
				) : (
					<p className="muted">{warmSummary(progress, running)}</p>
				)}
			</div>

			{note === null ? null : <p className="muted">{note}</p>}
			{binder.isError ? (
				<p className="error">
					The masterset did not load, so there is nothing to warm: {(binder.error as Error).message}
				</p>
			) : null}
		</section>
	);
}
