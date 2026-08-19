/**
 * Clone-and-edit, the blank form, and the edit of a row the owner typed.
 *
 * Identity is never a field. The client mints two UUIDs; the server prefixes them `manual:`.
 * A clone copies display fields off the source and nothing of its identity — that is the
 * whole point of the reserved namespace.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { BinderEntry } from "../../shared/contract.ts";
import type { ManualVariantDocument } from "../../shared/manual.ts";
import { createManualVariant, deleteManualVariant, updateManualVariant } from "../api.ts";
import { invalidateAfter, newCopyId } from "../collection.ts";

export interface ManualFormValues {
	language: string;
	setId: string;
	setName: string;
	localId: string;
	name: string;
	rarity: string;
	finish: string;
	subtype: string;
	stamps: string;
	foil: string;
	size: string;
}

export const EMPTY_MANUAL_FORM: ManualFormValues = {
	language: "",
	setId: "",
	setName: "",
	localId: "",
	name: "",
	rarity: "",
	finish: "",
	subtype: "",
	stamps: "",
	foil: "",
	size: "",
};

export function manualFormFrom(entry: BinderEntry): ManualFormValues {
	return {
		language: entry.language,
		setId: entry.setId,
		setName: entry.setName ?? "",
		localId: entry.localId,
		name: entry.name,
		rarity: entry.rarity ?? "",
		finish: entry.finish ?? "",
		subtype: entry.subtype ?? "",
		stamps: entry.stamps.join(", "),
		foil: entry.foil ?? "",
		size: entry.size ?? "",
	};
}

function blank(value: string): boolean {
	return value.trim() === "";
}

function stampsFrom(value: string): string[] {
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
}

function Field({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
	const id = useId();
	return (
		<div className="copy-field">
			<label htmlFor={id}>{label}</label>
			{children(id)}
		</div>
	);
}

export function ManualVariantForm({
	values,
	onChange,
	onSubmit,
	onCancel,
	busy,
	submitLabel,
}: {
	values: ManualFormValues;
	onChange: (next: ManualFormValues) => void;
	onSubmit: () => void;
	onCancel: () => void;
	busy: boolean;
	submitLabel: string;
}) {
	const set = <K extends keyof ManualFormValues>(key: K, value: string) =>
		onChange({ ...values, [key]: value });

	return (
		<form
			className="copy-form"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<Field label="Language">
				{(id) => (
					<input
						id={id}
						value={values.language}
						onChange={(e) => set("language", e.target.value)}
						placeholder="ko"
						autoComplete="off"
						autoCapitalize="off"
						spellCheck={false}
					/>
				)}
			</Field>
			<Field label="Set id">
				{(id) => (
					<input
						id={id}
						value={values.setId}
						onChange={(e) => set("setId", e.target.value)}
						placeholder="base2"
						autoComplete="off"
						spellCheck={false}
					/>
				)}
			</Field>
			<Field label="Set name">
				{(id) => (
					<input id={id} value={values.setName} onChange={(e) => set("setName", e.target.value)} />
				)}
			</Field>
			<Field label="Number">
				{(id) => (
					<input
						id={id}
						value={values.localId}
						onChange={(e) => set("localId", e.target.value)}
						placeholder="44"
						autoComplete="off"
						spellCheck={false}
					/>
				)}
			</Field>
			<Field label="Name">
				{(id) => (
					<input id={id} value={values.name} onChange={(e) => set("name", e.target.value)} />
				)}
			</Field>
			<Field label="Rarity">
				{(id) => (
					<input id={id} value={values.rarity} onChange={(e) => set("rarity", e.target.value)} />
				)}
			</Field>
			<Field label="Finish">
				{(id) => (
					<input
						id={id}
						value={values.finish}
						onChange={(e) => set("finish", e.target.value)}
						placeholder="normal / holo / reverse"
					/>
				)}
			</Field>
			<Field label="Subtype">
				{(id) => (
					<input id={id} value={values.subtype} onChange={(e) => set("subtype", e.target.value)} />
				)}
			</Field>
			<Field label="Stamps">
				{(id) => (
					<input
						id={id}
						value={values.stamps}
						onChange={(e) => set("stamps", e.target.value)}
						placeholder="1st-edition, set-logo"
					/>
				)}
			</Field>
			<Field label="Foil">
				{(id) => (
					<input id={id} value={values.foil} onChange={(e) => set("foil", e.target.value)} />
				)}
			</Field>
			<Field label="Size">
				{(id) => (
					<input id={id} value={values.size} onChange={(e) => set("size", e.target.value)} />
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

/**
 * The sheet's hand-added controls: clone from this printing, or edit/delete if this row
 * is one the owner typed.
 */
export function ManualVariantControls({
	entry,
	onCreated,
	onDeleted,
}: {
	entry: BinderEntry;
	onCreated: (created: ManualVariantDocument) => void;
	onDeleted: () => void;
}) {
	const queryClient = useQueryClient();
	const [mode, setMode] = useState<"closed" | "clone" | "edit" | "delete">("closed");
	const [values, setValues] = useState<ManualFormValues>(EMPTY_MANUAL_FORM);
	const [formError, setFormError] = useState<string | null>(null);

	const afterWrite = () => invalidateAfter(queryClient, "manual-write");

	const create = useMutation({
		mutationFn: createManualVariant,
		onSuccess: (created) => {
			afterWrite();
			setMode("closed");
			onCreated(created);
		},
	});

	const edit = useMutation({
		mutationFn: (patch: Parameters<typeof updateManualVariant>[2]) =>
			updateManualVariant(entry.cardKey, entry.variantId, patch),
		onSuccess: () => {
			afterWrite();
			setMode("closed");
		},
	});

	const remove = useMutation({
		mutationFn: () => deleteManualVariant(entry.cardKey, entry.variantId),
		onSuccess: () => {
			afterWrite();
			setMode("closed");
			onDeleted();
		},
	});

	const busy = create.isPending || edit.isPending || remove.isPending;
	const writeError = create.error ?? edit.error ?? remove.error;

	function submit() {
		if (
			blank(values.language) ||
			blank(values.setId) ||
			blank(values.localId) ||
			blank(values.name)
		) {
			setFormError("language, set, number and name are required");
			return;
		}
		setFormError(null);
		const fields = {
			language: values.language.trim(),
			setId: values.setId.trim(),
			setName: blank(values.setName) ? null : values.setName.trim(),
			localId: values.localId.trim(),
			name: values.name.trim(),
			rarity: blank(values.rarity) ? null : values.rarity.trim(),
			finish: blank(values.finish) ? null : values.finish.trim(),
			subtype: blank(values.subtype) ? null : values.subtype.trim(),
			stamps: stampsFrom(values.stamps),
			foil: blank(values.foil) ? null : values.foil.trim(),
			size: blank(values.size) ? null : values.size.trim(),
		};
		if (mode === "clone") {
			create.mutate({
				id: newCopyId(),
				variantId: newCopyId(),
				...fields,
			});
			return;
		}
		edit.mutate(fields);
	}

	return (
		<section className="sheet-copies">
			<h3>Masterset</h3>
			{mode === "closed" ? (
				<div className="actions">
					<button
						type="button"
						onClick={() => {
							setFormError(null);
							setValues(manualFormFrom(entry));
							setMode("clone");
						}}
					>
						Clone
					</button>
					{entry.provenance === "manual" ? (
						<>
							<button
								type="button"
								className="quiet"
								onClick={() => {
									setFormError(null);
									setValues(manualFormFrom(entry));
									setMode("edit");
								}}
							>
								Edit
							</button>
							<button
								type="button"
								className="quiet"
								onClick={() => {
									setFormError(null);
									setMode("delete");
								}}
							>
								Delete
							</button>
						</>
					) : null}
				</div>
			) : null}

			{mode === "clone" || mode === "edit" ? (
				<>
					<p className="muted">
						{mode === "clone"
							? "A new card, in the reserved namespace. Change the language or anything else that differs."
							: "Editing this hand-added row. Identity stays; a sync will not touch it."}
					</p>
					<ManualVariantForm
						values={values}
						onChange={setValues}
						onSubmit={submit}
						onCancel={() => setMode("closed")}
						busy={busy}
						submitLabel={mode === "clone" ? "Add to the masterset" : "Save"}
					/>
				</>
			) : null}

			{mode === "delete" ? (
				<div className="copy-dispose">
					<p className="muted">
						Removes this hand-added card from the masterset. Copies pointing at it must be disposed
						first.
					</p>
					<div className="actions">
						<button type="button" onClick={() => remove.mutate()} disabled={busy}>
							Delete it
						</button>
						<button
							type="button"
							className="quiet"
							onClick={() => setMode("closed")}
							disabled={busy}
						>
							Cancel
						</button>
					</div>
				</div>
			) : null}

			{formError === null ? null : <p className="error">{formError}</p>}
			{writeError === null ? null : <p className="error">{writeError.message}</p>}
		</section>
	);
}

/** The blank form, for a card with no relative to clone. */
export function BlankManualEntry({
	onCreated,
	onCancel,
}: {
	onCreated: (created: ManualVariantDocument) => void;
	onCancel: () => void;
}) {
	const queryClient = useQueryClient();
	const [values, setValues] = useState<ManualFormValues>(EMPTY_MANUAL_FORM);
	const [formError, setFormError] = useState<string | null>(null);

	const create = useMutation({
		mutationFn: createManualVariant,
		onSuccess: (created) => {
			invalidateAfter(queryClient, "manual-write");
			onCreated(created);
		},
	});

	function submit() {
		if (
			blank(values.language) ||
			blank(values.setId) ||
			blank(values.localId) ||
			blank(values.name)
		) {
			setFormError("language, set, number and name are required");
			return;
		}
		setFormError(null);
		create.mutate({
			id: newCopyId(),
			variantId: newCopyId(),
			language: values.language.trim(),
			setId: values.setId.trim(),
			setName: blank(values.setName) ? null : values.setName.trim(),
			localId: values.localId.trim(),
			name: values.name.trim(),
			rarity: blank(values.rarity) ? null : values.rarity.trim(),
			finish: blank(values.finish) ? null : values.finish.trim(),
			subtype: blank(values.subtype) ? null : values.subtype.trim(),
			stamps: stampsFrom(values.stamps),
			foil: blank(values.foil) ? null : values.foil.trim(),
			size: blank(values.size) ? null : values.size.trim(),
		});
	}

	return (
		<section className="sheet" role="dialog" aria-modal="true" aria-label="Add a variant">
			<header className="sheet-head">
				<div>
					<h2 className="sheet-name">Add a variant</h2>
					<p className="sheet-set">No relative to clone — typed from scratch.</p>
				</div>
				<button type="button" className="quiet" onClick={onCancel}>
					Close
				</button>
			</header>
			<div className="sheet-body">
				<ManualVariantForm
					values={values}
					onChange={setValues}
					onSubmit={submit}
					onCancel={onCancel}
					busy={create.isPending}
					submitLabel="Add to the masterset"
				/>
				{formError === null ? null : <p className="error">{formError}</p>}
				{create.error === null ? null : <p className="error">{create.error.message}</p>}
			</div>
		</section>
	);
}
