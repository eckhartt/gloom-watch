/**
 * The outbox — writes made while the tailnet is unreachable, held and replayed in order.
 *
 * There is no database on the phone and no sync engine. The cached shell can open with the API
 * down; marking a card owned in that state has to go somewhere. That somewhere is this queue.
 *
 * **Replay is idempotent because the identifiers are the client's.** A create whose response was
 * lost replays into the same row, not a duplicate. One user, one device, so last-write-wins is
 * enough and there is no merge.
 *
 * Photo uploads are **not** eligible. They are multi-megabyte and must never sit in IndexedDB;
 * they are held as metadata with a visible pending state instead.
 *
 * Storage is injected so a test can drive the same enqueue/replay against `createApp` and a
 * temporary database, and the browser can hand the same functions an IndexedDB backend.
 */

import type {
	CopyCreateRequest,
	CopyDisposalRequest,
	CopyDocument,
	CopyPatchRequest,
	PriorityRequest,
} from "./copies.ts";
import { COPIES_PATH, copyDisposalPath, copyPath, PRIORITIES_PATH } from "./copies.ts";
import { listingPath } from "./listings.ts";

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every mutation the spec names as outbox-eligible. Match confirmations and alias creation have
 * no UI yet — the matcher is a later ticket — but they still have to *queue*, so the kinds and
 * the paths live here and the later ticket posts through them rather than inventing a second
 * identity scheme.
 */
export const OUTBOX_KINDS = [
	"copy-create",
	"copy-update",
	"copy-dispose",
	"priority",
	"match-confirm",
	"alias-create",
] as const;

export type OutboxKind = (typeof OUTBOX_KINDS)[number];

/** Photographs. Named so a future upload path cannot quietly join the queue by looking like a copy. */
export const PHOTO_KIND = "photo-upload";

export type OutboxMethod = "POST" | "PUT" | "PATCH";

export interface OutboxMutation {
	readonly kind: string;
	readonly method: OutboxMethod;
	readonly path: string;
	readonly body: unknown;
}

export interface OutboxEntry extends OutboxMutation {
	/** Queue identity, not the copy's. The copy's UUID lives on `body`. */
	readonly id: string;
	/** Monotonic. Replay walks this, never insertion order of a hash map. */
	readonly seq: number;
	readonly enqueuedAt: number;
	/** Set when a replay failed. The entry stays; silence would drop the mutation. */
	readonly lastError: string | null;
}

export interface PhotoHold {
	readonly id: string;
	readonly copyId: string | null;
	readonly heldAt: number;
}

export class PhotoNotOutboxEligibleError extends Error {
	readonly copyId: string | null;

	constructor(copyId: string | null) {
		super("photo uploads are not outbox-eligible");
		this.name = "PhotoNotOutboxEligibleError";
		this.copyId = copyId;
	}
}

/* -------------------------------------------------------------------------- */
/* Key-value backend                                                           */
/* -------------------------------------------------------------------------- */

export interface KvStore {
	get<T>(key: string): Promise<T | undefined>;
	set(key: string, value: unknown): Promise<void>;
	del(key: string): Promise<void>;
}

const ENTRIES_KEY = "gloom-watch:outbox:entries";
const SEQ_KEY = "gloom-watch:outbox:seq";
const PHOTOS_KEY = "gloom-watch:outbox:photos";

/** In-memory backend. What the tests drive, and the fallback before IndexedDB is wired. */
export function createMemoryKv(): KvStore {
	const map = new Map<string, unknown>();
	return {
		async get<T>(key: string): Promise<T | undefined> {
			if (!map.has(key)) return undefined;
			return map.get(key) as T;
		},
		async set(key: string, value: unknown): Promise<void> {
			map.set(key, value);
		},
		async del(key: string): Promise<void> {
			map.delete(key);
		},
	};
}

export interface OutboxStore {
	enqueue(mutation: OutboxMutation): Promise<OutboxEntry>;
	list(): Promise<readonly OutboxEntry[]>;
	remove(id: string): Promise<void>;
	markFailed(id: string, message: string): Promise<void>;
	holdPhoto(copyId: string | null): Promise<PhotoHold>;
	photoHolds(): Promise<readonly PhotoHold[]>;
	pendingCount(): Promise<number>;
	subscribe(listener: () => void): () => void;
}

export interface OutboxStoreOptions {
	readonly now?: () => number;
	readonly id?: () => string;
}

function newId(): string {
	return crypto.randomUUID();
}

export function createOutboxStore(kv: KvStore, options: OutboxStoreOptions = {}): OutboxStore {
	const now = options.now ?? (() => Date.now());
	const id = options.id ?? newId;
	const listeners = new Set<() => void>();

	const notify = () => {
		for (const listener of listeners) listener();
	};

	const readEntries = async (): Promise<OutboxEntry[]> => {
		const entries = (await kv.get<OutboxEntry[]>(ENTRIES_KEY)) ?? [];
		return [...entries].sort((a, b) => a.seq - b.seq);
	};

	return {
		async enqueue(mutation) {
			const seq = ((await kv.get<number>(SEQ_KEY)) ?? 0) + 1;
			await kv.set(SEQ_KEY, seq);
			const entry: OutboxEntry = {
				kind: mutation.kind,
				method: mutation.method,
				path: mutation.path,
				body: mutation.body,
				id: id(),
				seq,
				enqueuedAt: now(),
				lastError: null,
			};
			const entries = await readEntries();
			entries.push(entry);
			await kv.set(ENTRIES_KEY, entries);
			notify();
			return entry;
		},

		list: readEntries,

		async remove(entryId) {
			const entries = (await readEntries()).filter((entry) => entry.id !== entryId);
			await kv.set(ENTRIES_KEY, entries);
			notify();
		},

		async markFailed(entryId, message) {
			const entries = (await readEntries()).map((entry) =>
				entry.id === entryId ? { ...entry, lastError: message } : entry,
			);
			await kv.set(ENTRIES_KEY, entries);
			notify();
		},

		async holdPhoto(copyId) {
			const hold: PhotoHold = { id: id(), copyId, heldAt: now() };
			const holds = (await kv.get<PhotoHold[]>(PHOTOS_KEY)) ?? [];
			holds.push(hold);
			await kv.set(PHOTOS_KEY, holds);
			notify();
			return hold;
		},

		async photoHolds() {
			return (await kv.get<PhotoHold[]>(PHOTOS_KEY)) ?? [];
		},

		async pendingCount() {
			return (await readEntries()).length;
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

/* -------------------------------------------------------------------------- */
/* Eligibility                                                                 */
/* -------------------------------------------------------------------------- */

export function isOutboxKind(kind: string): kind is OutboxKind {
	return (OUTBOX_KINDS as readonly string[]).includes(kind);
}

/**
 * Photographs, by kind *or* by path. A later ticket that posts to `/photos` without setting the
 * kind still must not land in the queue — the blob is the problem, not the label.
 */
export function isPhotoMutation(mutation: Pick<OutboxMutation, "kind" | "path">): boolean {
	if (mutation.kind === PHOTO_KIND) return true;
	return /\/photos?(?:\/|$)/i.test(mutation.path);
}

function photoCopyId(mutation: OutboxMutation): string | null {
	const fromPath = /\/copies\/([^/]+)\/photos?/i.exec(mutation.path);
	if (fromPath?.[1] !== undefined) return decodeURIComponent(fromPath[1]);
	if (typeof mutation.body === "object" && mutation.body !== null && "copyId" in mutation.body) {
		const value = (mutation.body as { copyId: unknown }).copyId;
		return typeof value === "string" ? value : null;
	}
	return null;
}

/**
 * Put a mutation on the queue, or refuse it.
 *
 * Photographs are held (metadata only — never the blob) and throw, so a caller that forgot the
 * rule cannot silently park megabytes in IndexedDB. Unknown kinds are refused outright.
 */
export async function enqueue(store: OutboxStore, mutation: OutboxMutation): Promise<OutboxEntry> {
	if (isPhotoMutation(mutation)) {
		const copyId = photoCopyId(mutation);
		await store.holdPhoto(copyId);
		throw new PhotoNotOutboxEligibleError(copyId);
	}
	if (!isOutboxKind(mutation.kind)) {
		throw new Error(`not an outbox-eligible mutation: ${mutation.kind}`);
	}
	return store.enqueue(mutation);
}

/**
 * Hold a photo attempt without putting anything on the outbox.
 *
 * Used when the owner tries to attach a photograph with the tailnet down. The processor itself
 * is a later ticket; this is only the exclusion and the visible pending state.
 */
export async function holdPhotoAttempt(
	store: OutboxStore,
	copyId: string | null,
): Promise<PhotoHold> {
	return store.holdPhoto(copyId);
}

/* -------------------------------------------------------------------------- */
/* Constructors — one per eligible kind, so callers do not invent paths        */
/* -------------------------------------------------------------------------- */

export function copyCreateMutation(request: CopyCreateRequest): OutboxMutation {
	return { kind: "copy-create", method: "POST", path: COPIES_PATH, body: request };
}

export function copyUpdateMutation(id: string, patch: CopyPatchRequest): OutboxMutation {
	return { kind: "copy-update", method: "PATCH", path: copyPath(id), body: patch };
}

export function copyDisposeMutation(id: string, request: CopyDisposalRequest): OutboxMutation {
	return { kind: "copy-dispose", method: "POST", path: copyDisposalPath(id), body: request };
}

export function priorityMutation(request: PriorityRequest): OutboxMutation {
	return { kind: "priority", method: "PUT", path: PRIORITIES_PATH, body: request };
}

/**
 * Confirm a queued listing. The matcher ticket owns the body; the path is fixed here so a
 * replayed confirm cannot invent a second URL.
 */
export function matchConfirmMutation(itemId: string, body: unknown): OutboxMutation {
	return {
		kind: "match-confirm",
		method: "POST",
		path: `${listingPath(itemId)}/confirm`,
		body,
	};
}

/**
 * Teach an alias. **The client mints `id`**, same convention as copies, so a replay lands in
 * one row. The aliases table itself is a later ticket; the outbox already knows the path.
 */
export function aliasCreateMutation(
	body: { readonly id: string } & Record<string, unknown>,
): OutboxMutation {
	return { kind: "alias-create", method: "POST", path: "/api/aliases", body };
}

export function photoUploadMutation(copyId: string, body: unknown = {}): OutboxMutation {
	return {
		kind: PHOTO_KIND,
		method: "POST",
		path: `${copyPath(copyId)}/photos`,
		body,
	};
}

/* -------------------------------------------------------------------------- */
/* Replay                                                                      */
/* -------------------------------------------------------------------------- */

export interface ReplayResult {
	readonly ok: boolean;
	readonly status: number;
	readonly error?: string;
}

/**
 * How a mutation is sent. Tests inject Hono's `app.request`; the browser injects `fetch`.
 * The replay function does not care which — that is what lets the named test drive the
 * *shipped* replay against `createApp` rather than reimplement it.
 */
export type OutboxTransport = (mutation: OutboxMutation) => Promise<ReplayResult>;

export function createTransport(
	request: (path: string, init?: RequestInit) => Response | Promise<Response>,
): OutboxTransport {
	return async (mutation) => {
		let response: Response;
		try {
			response = await request(mutation.path, {
				method: mutation.method,
				headers: { "content-type": "application/json", accept: "application/json" },
				body: JSON.stringify(mutation.body),
			});
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : String(cause);
			return { ok: false, status: 0, error: message };
		}

		if (response.ok) return { ok: true, status: response.status };

		const payload: unknown = await response.json().catch(() => null);
		const error =
			typeof payload === "object" && payload !== null && "error" in payload
				? String((payload as { error: unknown }).error)
				: `HTTP ${response.status}`;
		return { ok: false, status: response.status, error };
	};
}

/**
 * Send one mutation. **Does not touch the store** — a test can replay the same create twice
 * and observe one row, which is the whole point of client-minted identifiers.
 */
export async function replayMutation(
	mutation: OutboxMutation,
	transport: OutboxTransport,
): Promise<ReplayResult> {
	return transport(mutation);
}

export interface DrainResult {
	readonly replayed: number;
	readonly failed: OutboxEntry | null;
}

/**
 * Replay the queue in enqueue order.
 *
 * A failure **keeps the entry and stops.** Continuing would let a later patch overtake a create
 * that has not landed, and dropping the failed one would silently lose a card the owner thought
 * they had recorded. Neither is acceptable.
 */
export async function replayOutbox(
	store: OutboxStore,
	transport: OutboxTransport,
): Promise<DrainResult> {
	const entries = await store.list();
	let replayed = 0;
	for (const entry of entries) {
		const result = await replayMutation(entry, transport);
		if (!result.ok) {
			const message = result.error ?? `HTTP ${result.status}`;
			await store.markFailed(entry.id, message);
			return { replayed, failed: { ...entry, lastError: message } };
		}
		await store.remove(entry.id);
		replayed += 1;
	}
	return { replayed, failed: null };
}

/**
 * A failed fetch, a dropped tailnet, a proxy 502. **Not** a 400 — the owner typed something
 * the server refused, and queuing that would replay the same refusal forever.
 *
 * `navigator.onLine` is not consulted. The browser's offline emulation (and a Tailscale
 * tunnel that has dropped while the radio is up) both leave that flag `true`, which is the
 * realistic case this queue exists for.
 */
export function isNetworkFailure(error: unknown): boolean {
	if (error instanceof TypeError) return true;
	if (typeof error === "object" && error !== null && "status" in error) {
		const status = (error as { status: unknown }).status;
		if (status === 0) return true;
		if (typeof status === "number" && status >= 502 && status <= 504) return true;
	}
	const message = error instanceof Error ? error.message : String(error);
	return /failed to fetch|networkerror|load failed|econnrefused|enotfound|other side closed|unable to connect/i.test(
		message,
	);
}

/** A copy document the UI can render before the server has seen the write. */
export function optimisticCopyDocument(request: CopyCreateRequest, now = Date.now()): CopyDocument {
	return {
		id: request.id,
		cardKey: request.cardKey,
		variantId: request.variantId,
		condition: request.condition ?? null,
		grader: request.grader ?? null,
		grade: request.grade ?? null,
		certNo: request.certNo ?? null,
		priceMinor: request.priceMinor ?? null,
		currency: request.currency ?? null,
		priceHomeMinor: request.priceHomeMinor ?? null,
		homeCurrency: request.homeCurrency ?? null,
		rateDate: request.rateDate ?? null,
		acquiredAt: request.acquiredAt ?? null,
		sourceType: request.sourceType ?? null,
		sourceNote: request.sourceNote ?? null,
		note: request.note ?? null,
		status: "owned",
		disposedAt: null,
		disposalKind: null,
		createdAt: now,
		updatedAt: now,
	};
}

/* -------------------------------------------------------------------------- */
/* Process-wide store                                                          */
/* -------------------------------------------------------------------------- */

let defaultStore: OutboxStore | undefined;

export function setDefaultOutboxStore(store: OutboxStore): void {
	defaultStore = store;
}

export function getDefaultOutboxStore(): OutboxStore {
	defaultStore ??= createOutboxStore(createMemoryKv());
	return defaultStore;
}

/**
 * Drain when the radio comes back, and once at startup in case the last session queued
 * something and died before the `online` event.
 *
 * `target` is injected so a test can fire `online` without a `window`.
 */
export function startOutboxPump(options: {
	readonly store: OutboxStore;
	readonly transport: OutboxTransport;
	readonly target?: {
		addEventListener: (type: string, listener: () => void) => void;
		removeEventListener: (type: string, listener: () => void) => void;
	} | null;
	readonly onDrained?: (result: DrainResult) => void;
	/** Drain once immediately. Tests that fire `online` themselves pass `false`. */
	readonly immediate?: boolean;
}): { stop: () => void; drain: () => Promise<DrainResult | null> } {
	let draining = false;
	const drain = async (): Promise<DrainResult | null> => {
		if (draining) return null;
		draining = true;
		try {
			const result = await replayOutbox(options.store, options.transport);
			if (result.replayed > 0) options.onDrained?.(result);
			return result;
		} finally {
			draining = false;
		}
	};

	const onOnline = () => {
		void drain();
	};
	const target = options.target === undefined ? defaultEventTarget() : options.target;
	target?.addEventListener("online", onOnline);
	if (options.immediate !== false) void drain();
	return {
		stop: () => {
			target?.removeEventListener("online", onOnline);
		},
		drain,
	};
}

function defaultEventTarget(): {
	addEventListener: (type: string, listener: () => void) => void;
	removeEventListener: (type: string, listener: () => void) => void;
} | null {
	return typeof globalThis.addEventListener === "function"
		? (globalThis as unknown as {
				addEventListener: (type: string, listener: () => void) => void;
				removeEventListener: (type: string, listener: () => void) => void;
			})
		: null;
}
