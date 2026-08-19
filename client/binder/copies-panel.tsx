/**
 * The half of the variant sheet that is this ticket: the copies the owner holds of one variant,
 * a form to record another, and the dial for a variant they do not hold.
 *
 * **It lives inside the sheet, and the sheet is component state rather than a route.** Recording a
 * card must not navigate: the binder is the context the whole screen is built around and the
 * scroll position goes with it. That is a criterion of the ticket this one builds on, and adding a
 * route here would break it without breaking a single test.
 *
 * The layout is deliberately plain. The spec records the sheet's layout as **still undecided**,
 * so this is the dense typographic minimum that makes every field reachable — not a design
 * decision dressed up as one. Current listings are a later ticket and there is no placeholder
 * for them.
 */

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { BinderEntry } from "../../shared/contract.ts";
import type {
	CopyDisposalKind,
	CopyDisposalRequest,
	CopyDocument,
	CopyPatchRequest,
} from "../../shared/copies.ts";
import {
	CERT_NO_MAX_LENGTH,
	COPY_CONDITIONS,
	COPY_DISPOSAL_KINDS,
	COPY_GRADERS,
	COPY_SOURCE_TYPES,
	MAX_PRIORITY,
	PRIORITY_LEVELS,
	photographPath,
} from "../../shared/copies.ts";
import {
	attachPhotograph,
	createCopy,
	deletePhotograph,
	disposeCopy,
	fetchCopyPhotographs,
	fetchVariantCopies,
	setVariantPriority,
	updateCopy,
} from "../api.ts";
import {
	copyPhotographsQueryKey,
	invalidateAfter,
	newCopyId,
	newPhotographId,
	variantCopiesQueryKey,
} from "../collection.ts";
import type { CopyFormValues } from "./copy-form.ts";
import { copyFieldsFrom, copyFormFrom, EMPTY_COPY_FORM } from "./copy-form.ts";
import { copyPresentation } from "./presentation.ts";

/** The device's calendar date, as an ISO string. A date, never an instant — so never `toISOString`. */
function todayIso(): string {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * A labelled control.
 *
 * The child is a function of the id rather than a plain node so the `<label>` can carry `htmlFor`
 * and the control the matching `id`. Nesting alone would associate them in a browser, but not for
 * VoiceOver's rotor and not for a static check — and the same sheet has to be usable by ear.
 */
function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
	const id = useId();
	return (
		<div className="copy-field">
			<label htmlFor={id}>{label}</label>
			{children(id)}
		</div>
	);
}

function Options({ values }: { values: readonly string[] }) {
	return (
		<>
			<option value="">—</option>
			{values.map((value) => (
				<option key={value} value={value}>
					{value}
				</option>
			))}
		</>
	);
}

function CopyForm({
	values,
	onChange,
	onSubmit,
	onCancel,
	busy,
	submitLabel,
}: {
	values: CopyFormValues;
	onChange: (next: CopyFormValues) => void;
	onSubmit: () => void;
	onCancel: () => void;
	busy: boolean;
	submitLabel: string;
}) {
	const set = <K extends keyof CopyFormValues>(key: K, value: string) =>
		onChange({ ...values, [key]: value });

	return (
		<form
			className="copy-form"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<Field label="Condition">
				{(id) => (
					<select
						id={id}
						value={values.condition}
						onChange={(e) => set("condition", e.target.value)}
					>
						<Options values={COPY_CONDITIONS} />
					</select>
				)}
			</Field>
			<Field label="Grader">
				{(id) => (
					<select id={id} value={values.grader} onChange={(e) => set("grader", e.target.value)}>
						<Options values={COPY_GRADERS} />
					</select>
				)}
			</Field>
			<Field label="Grade">
				{/* Typed as the label reads it. `8.5` becomes 85 tenths on the way to the server. */}
				{(id) => (
					<input
						id={id}
						value={values.grade}
						onChange={(e) => set("grade", e.target.value)}
						inputMode="decimal"
						placeholder="8.5"
					/>
				)}
			</Field>
			<Field label="Cert no.">
				{(id) => (
					<input
						id={id}
						value={values.certNo}
						onChange={(e) => set("certNo", e.target.value)}
						maxLength={CERT_NO_MAX_LENGTH}
					/>
				)}
			</Field>

			<Field label="Paid">
				{(id) => (
					<span className="copy-pair">
						<input
							id={id}
							value={values.priceAmount}
							onChange={(e) => set("priceAmount", e.target.value)}
							inputMode="decimal"
							placeholder="12.50"
						/>
						{/* Never a bare number: the code travels with the amount or neither is stored. */}
						<input
							className="copy-currency"
							aria-label="Currency paid in"
							value={values.currency}
							onChange={(e) => set("currency", e.target.value.toUpperCase())}
							maxLength={3}
							placeholder="AUD"
						/>
					</span>
				)}
			</Field>
			<Field label="Home value">
				{(id) => (
					<span className="copy-pair">
						<input
							id={id}
							value={values.homeAmount}
							onChange={(e) => set("homeAmount", e.target.value)}
							inputMode="decimal"
						/>
						<input
							className="copy-currency"
							aria-label="Home currency"
							value={values.homeCurrency}
							onChange={(e) => set("homeCurrency", e.target.value.toUpperCase())}
							maxLength={3}
						/>
					</span>
				)}
			</Field>
			<Field label="Rate taken">
				{/* Typed by hand, with the amount above it. There is no FX API and there is not going
				    to be one, so this date is the only record of which day the conversion is from. */}
				{(id) => (
					<input
						id={id}
						type="date"
						value={values.rateDate}
						onChange={(e) => set("rateDate", e.target.value)}
					/>
				)}
			</Field>

			<Field label="Acquired">
				{(id) => (
					<input
						id={id}
						type="date"
						value={values.acquiredAt}
						onChange={(e) => set("acquiredAt", e.target.value)}
					/>
				)}
			</Field>
			<Field label="Source">
				{(id) => (
					<select
						id={id}
						value={values.sourceType}
						onChange={(e) => set("sourceType", e.target.value)}
					>
						<Options values={COPY_SOURCE_TYPES} />
					</select>
				)}
			</Field>
			<Field label="Source note">
				{(id) => (
					<input
						id={id}
						value={values.sourceNote}
						onChange={(e) => set("sourceNote", e.target.value)}
					/>
				)}
			</Field>
			<Field label="Note">
				{/* Where an off-centre cut or a soft corner goes. Defects are prose and never data —
				    no enum, no flag, nothing to filter or sort on. */}
				{(id) => (
					<textarea
						id={id}
						value={values.note}
						onChange={(e) => set("note", e.target.value)}
						rows={2}
					/>
				)}
			</Field>

			<div className="actions">
				<button type="submit" disabled={busy}>
					{submitLabel}
				</button>
				<button type="button" className="quiet" onClick={onCancel} disabled={busy}>
					Cancel
				</button>
			</div>
		</form>
	);
}

function DisposalForm({
	onConfirm,
	onCancel,
	busy,
}: {
	onConfirm: (disposedAt: string, kind: CopyDisposalKind | null) => void;
	onCancel: () => void;
	busy: boolean;
}) {
	const [disposedAt, setDisposedAt] = useState(todayIso());
	const [kind, setKind] = useState<string>("");

	return (
		<div className="copy-dispose">
			{/* The row is kept, marked. Said out loud because "dispose" beside a list of things you
			    own reads like a delete, and this one never is. */}
			<p className="muted">Sold, traded or lost. The record stays, marked disposed.</p>
			<Field label="On">
				{(id) => (
					<input
						id={id}
						type="date"
						value={disposedAt}
						onChange={(e) => setDisposedAt(e.target.value)}
					/>
				)}
			</Field>
			<Field label="How">
				{(id) => (
					<select id={id} value={kind} onChange={(e) => setKind(e.target.value)}>
						<Options values={COPY_DISPOSAL_KINDS} />
					</select>
				)}
			</Field>
			<div className="actions">
				<button
					type="button"
					onClick={() => onConfirm(disposedAt, kind === "" ? null : (kind as CopyDisposalKind))}
					disabled={busy || disposedAt === ""}
				>
					Dispose
				</button>
				<button type="button" className="quiet" onClick={onCancel} disabled={busy}>
					Cancel
				</button>
			</div>
		</div>
	);
}

function CopyRow({
	copy,
	onEdit,
	onDispose,
}: {
	copy: CopyDocument;
	onEdit: () => void;
	onDispose: () => void;
}) {
	const presentation = copyPresentation(copy);
	return (
		<li className={presentation.disposal === null ? "copy" : "copy copy-disposed"}>
			<div className="copy-lines">
				<span className="copy-headline">{presentation.headline}</span>
				{presentation.detail === "" ? null : <span className="muted">{presentation.detail}</span>}
				{presentation.disposal === null ? null : (
					<span className="muted">{presentation.disposal}</span>
				)}
				{copy.note === null ? null : <span className="muted copy-note">{copy.note}</span>}
				<CopyPhotographs copyId={copy.id} />
			</div>
			<div className="copy-buttons">
				<button type="button" className="quiet" onClick={onEdit}>
					Edit
				</button>
				{presentation.disposal === null ? (
					<button type="button" className="quiet" onClick={onDispose}>
						Dispose
					</button>
				) : null}
			</div>
		</li>
	);
}

function CopyPhotographs({ copyId }: { copyId: string }) {
	const queryClient = useQueryClient();
	const inputId = useId();
	const photos = useQuery({
		queryKey: copyPhotographsQueryKey(copyId),
		queryFn: ({ signal }) => fetchCopyPhotographs(copyId, signal),
	});

	const attach = useMutation({
		mutationFn: (file: Blob) => attachPhotograph(copyId, newPhotographId(), file),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: copyPhotographsQueryKey(copyId) });
		},
	});
	const remove = useMutation({
		mutationFn: deletePhotograph,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: copyPhotographsQueryKey(copyId) });
		},
	});

	const busy = attach.isPending || remove.isPending;
	const writeError = attach.error ?? remove.error;
	const held = photos.data ?? [];

	return (
		<div className="copy-photos">
			{held.length === 0 ? null : (
				<ul className="copy-photo-list">
					{held.map((photo) => (
						<li key={photo.id}>
							<img src={photographPath(photo.id)} alt="Owner photograph of this copy" />
							<button
								type="button"
								className="quiet"
								disabled={busy}
								onClick={() => remove.mutate(photo.id)}
							>
								Delete
							</button>
						</li>
					))}
				</ul>
			)}
			<label className="copy-photo-add" htmlFor={inputId}>
				Photograph
				<input
					id={inputId}
					type="file"
					accept="image/*"
					capture="environment"
					multiple
					disabled={busy}
					onChange={(event) => {
						const files = Array.from(event.target.files ?? []);
						event.target.value = "";
						for (const file of files) {
							attach.mutate(file);
						}
					}}
				/>
			</label>
			{writeError === null ? null : <p className="error">{writeError.message}</p>}
		</div>
	);
}

/**
 * Owner photographs in the image column of the variant sheet, next to the corpus art.
 *
 * Reads the same queries the copy rows do, so attaching or deleting one updates both places
 * without a second request.
 */
export function SheetPhotographs({ entry }: { entry: BinderEntry }) {
	const copies = useQuery({
		queryKey: variantCopiesQueryKey(entry.cardKey, entry.variantId),
		queryFn: ({ signal }) => fetchVariantCopies(entry.cardKey, entry.variantId, signal),
	});
	const photoQueries = useQueries({
		queries: (copies.data ?? []).map((copy) => ({
			queryKey: copyPhotographsQueryKey(copy.id),
			queryFn: ({ signal }: { signal: AbortSignal }) => fetchCopyPhotographs(copy.id, signal),
		})),
	});
	const photographs = photoQueries.flatMap((query) => query.data ?? []);
	if (photographs.length === 0) return null;
	return (
		<div className="sheet-photos">
			{photographs.map((photo) => (
				<img
					key={photo.id}
					className="sheet-photo"
					src={photographPath(photo.id)}
					alt="Owner photograph"
				/>
			))}
		</div>
	);
}

export function CopiesPanel({ entry }: { entry: BinderEntry }) {
	const queryClient = useQueryClient();
	const queryKey = variantCopiesQueryKey(entry.cardKey, entry.variantId);

	const copies = useQuery({
		queryKey,
		queryFn: ({ signal }) => fetchVariantCopies(entry.cardKey, entry.variantId, signal),
	});

	const [form, setForm] = useState<CopyFormValues | null>(null);
	/** The copy being edited, or `null` when the form is recording a new one. */
	const [editingId, setEditingId] = useState<string | null>(null);
	const [disposingId, setDisposingId] = useState<string | null>(null);
	const [formError, setFormError] = useState<string | null>(null);

	/** Everything a write here falsifies: this list, the binder's ownership, and completion. */
	const afterWrite = () => {
		void queryClient.invalidateQueries({ queryKey });
		invalidateAfter(queryClient, "copy-write");
	};

	const create = useMutation({
		mutationFn: createCopy,
		onSuccess: () => {
			afterWrite();
			setForm(null);
		},
	});

	const edit = useMutation({
		mutationFn: (input: { id: string; patch: CopyPatchRequest }) =>
			updateCopy(input.id, input.patch),
		onSuccess: () => {
			afterWrite();
			setForm(null);
			setEditingId(null);
		},
	});

	const dispose = useMutation({
		mutationFn: (input: { id: string; request: CopyDisposalRequest }) =>
			disposeCopy(input.id, input.request),
		onSuccess: () => {
			afterWrite();
			setDisposingId(null);
		},
	});

	const priority = useMutation({
		mutationFn: setVariantPriority,
		// The dial rides on the binder document, so the grid is what has to be re-read.
		onSuccess: () => invalidateAfter(queryClient, "copy-write"),
	});

	const busy = create.isPending || edit.isPending || dispose.isPending;
	const writeError = create.error ?? edit.error ?? dispose.error ?? priority.error;
	const shownPriority = priority.isPending
		? (priority.variables?.priority ?? null)
		: entry.priority;

	function submitForm(values: CopyFormValues) {
		const parsed = copyFieldsFrom(values);
		if (!parsed.ok) {
			setFormError(parsed.message);
			return;
		}
		setFormError(null);
		if (editingId === null) {
			// **The client mints the identifier.** It is what makes an outbox replay land in this same
			// row rather than in a second card the owner does not have.
			create.mutate({
				id: newCopyId(),
				cardKey: entry.cardKey,
				variantId: entry.variantId,
				...parsed.fields,
			});
		} else {
			edit.mutate({ id: editingId, patch: parsed.fields });
		}
	}

	const held = copies.data ?? [];

	return (
		<section className="sheet-copies">
			<h3>Copies</h3>

			{copies.isPending ? <p className="muted">Reading…</p> : null}
			{copies.isError ? (
				// Ownership itself is on the cached binder document, so the count above is still right
				// with the tailnet down; only the trail below needs the server.
				<p className="error">The copies did not load: {(copies.error as Error).message}</p>
			) : null}
			{copies.isSuccess && held.length === 0 ? (
				<p className="muted">None recorded.</p>
			) : (
				<ul className="copy-list">
					{held.map((copy) => (
						<CopyRow
							key={copy.id}
							copy={copy}
							onEdit={() => {
								setEditingId(copy.id);
								setDisposingId(null);
								setFormError(null);
								setForm(copyFormFrom(copy));
							}}
							onDispose={() => {
								setDisposingId(copy.id);
								setForm(null);
							}}
						/>
					))}
				</ul>
			)}

			{disposingId !== null ? (
				<DisposalForm
					busy={busy}
					onCancel={() => setDisposingId(null)}
					onConfirm={(disposedAt, kind) =>
						dispose.mutate({ id: disposingId, request: { disposedAt, disposalKind: kind } })
					}
				/>
			) : null}

			{form === null ? (
				<div className="actions">
					<button
						type="button"
						onClick={() => {
							setEditingId(null);
							setDisposingId(null);
							setFormError(null);
							setForm(EMPTY_COPY_FORM);
						}}
					>
						Add a copy
					</button>
				</div>
			) : (
				<CopyForm
					values={form}
					onChange={setForm}
					onSubmit={() => submitForm(form)}
					onCancel={() => {
						setForm(null);
						setEditingId(null);
						setFormError(null);
					}}
					busy={busy}
					submitLabel={editingId === null ? "Record it" : "Save"}
				/>
			)}

			{formError === null ? null : <p className="error">{formError}</p>}
			{/* The server's own sentence — *a grade needs a grader* — rather than a status code, which
			    is the difference between a form the owner can correct and one they can only retry. */}
			{writeError === null ? null : <p className="error">{writeError.message}</p>}

			{entry.ownedCopies === 0 ? (
				/*
				 * **The dial, and only on a card the owner does not hold.** There is no want-list —
				 * anything unowned is implicitly wanted — and this ranks it, which is what decides
				 * whether a listing interrupts the owner or waits for the next digest.
				 *
				 * Hidden once a copy exists because the push rule suppresses owned variants outright,
				 * so the control would be connected to nothing. The stored value survives, so
				 * disposing of the copy brings the dial back set as it was.
				 */
				<div className="copy-priority">
					<Field label="Priority">
						{(id) => (
							<select
								id={id}
								// The submitted value while the write is in flight, the binder's answer once
								// it lands. Reading the entry throughout would snap the control back to the
								// old rung for as long as the ~290 KB binder takes to come back, which reads
								// as the app refusing the change.
								value={shownPriority === null ? "" : String(shownPriority)}
								disabled={priority.isPending}
								onChange={(e) =>
									priority.mutate({
										cardKey: entry.cardKey,
										variantId: entry.variantId,
										priority: e.target.value === "" ? null : Number(e.target.value),
									})
								}
							>
								<option value="">unset</option>
								{PRIORITY_LEVELS.map((level) => (
									<option key={level} value={String(level)}>
										{level === MAX_PRIORITY ? `${level} — pushes instantly` : String(level)}
									</option>
								))}
							</select>
						)}
					</Field>
				</div>
			) : null}
		</section>
	);
}
