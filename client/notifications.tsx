import { useCallback, useEffect, useState } from "react";
import type { PushSubscriptionDocument } from "../shared/push.ts";
import type { EnablePushResult, PushEnvironment } from "./push.ts";
import { enablePush, readPushEnvironment } from "./push.ts";

/**
 * The notifications section: a soft-ask, and a permanent re-enable button.
 *
 * **The soft-ask is mandatory and it is this card.** iOS gives exactly one chance at the system
 * prompt; a denial is effectively permanent and costs a trip through Settings to undo. So the app
 * explains itself first, and the system prompt is raised only from the tap on *Enable
 * notifications* — never on mount, never behind a redirect, never as a surprise.
 *
 * **The re-enable button is permanent, not an error state.** iOS invalidates subscriptions
 * silently and gives the page no event when it does — `pushsubscriptionchange` is not implemented
 * — so there is no moment at which the app can decide the button is needed. It is always there.
 * `subscribe()` also wants a user gesture on iOS even when permission is already granted, so the
 * recovery could not be automatic even if the app could detect the need for it.
 */

const SOFT_ASK_DISMISSED_KEY = "gloom-watch:soft-ask-dismissed";

function readDismissed(): boolean {
	try {
		return localStorage.getItem(SOFT_ASK_DISMISSED_KEY) === "1";
	} catch {
		// Private browsing, or storage disabled. Showing the soft-ask again is the harmless failure.
		return false;
	}
}

function writeDismissed(): void {
	try {
		localStorage.setItem(SOFT_ASK_DISMISSED_KEY, "1");
	} catch {
		// Nothing to do; the ask reappears next launch, which is not a fault worth reporting.
	}
}

const FAILURE_MESSAGES: Record<string, string> = {
	"not-standalone": "This is not running as an installed web app.",
	"no-push-api": "This install has no Push API. Re-add it with “Open as Web App” on.",
	"not-configured": "The server has no VAPID key yet. Run `bun run vapid:generate` on the box.",
	"permission-denied":
		"iOS has notifications off for this app. Settings → Notifications → Gloom Watch.",
	"permission-dismissed": "The prompt was dismissed. Tap the button again when you are ready.",
	"subscribe-failed": "The subscription could not be created.",
};

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="row">
			<dt>{label}</dt>
			<dd>{value}</dd>
		</div>
	);
}

function Blocked({ environment }: { environment: PushEnvironment }) {
	if (!environment.standalone) {
		return (
			<p className="muted">
				Notifications need the Home Screen web app. In Safari, tap Share, then{" "}
				<b>Add to Home Screen</b> with <b>Open as Web App</b> left on, and open this from the icon.
			</p>
		);
	}
	return (
		<p className="muted">
			This install has no Push API. iOS 26 lets <b>Open as Web App</b> be turned off at install
			time, which leaves a bookmark rather than a web app. Remove the icon and re-add it with that
			switch on.
		</p>
	);
}

export function NotificationSection() {
	const [environment, setEnvironment] = useState<PushEnvironment | null>(null);
	const [dismissed, setDismissed] = useState(false);
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<EnablePushResult | null>(null);
	const [registered, setRegistered] = useState<PushSubscriptionDocument | null>(null);

	// Reading capabilities is passive — it raises no prompt and takes no gesture.
	useEffect(() => {
		setEnvironment(readPushEnvironment());
		setDismissed(readDismissed());
	}, []);

	const onEnable = useCallback(() => {
		// Inside the click handler, so the platform sees a genuine user gesture. Nothing is awaited
		// before `enablePush` starts, because iOS consumes the gesture on the first await boundary.
		setBusy(true);
		setResult(null);
		void enablePush()
			.then((outcome) => {
				setResult(outcome);
				if (outcome.ok) setRegistered(outcome.subscription);
				setEnvironment(readPushEnvironment());
			})
			.catch((cause: unknown) => {
				setResult({
					ok: false,
					reason: "subscribe-failed",
					detail: (cause as Error).message,
				});
			})
			.finally(() => {
				setBusy(false);
			});
	}, []);

	const onDismiss = useCallback(() => {
		writeDismissed();
		setDismissed(true);
	}, []);

	if (environment === null) {
		return (
			<section>
				<h2>Notifications</h2>
				<p className="muted">Checking this device…</p>
			</section>
		);
	}

	const showSoftAsk = environment.ready && environment.permission === "default" && !dismissed;

	return (
		<section>
			<h2>Notifications</h2>

			{environment.ready ? null : <Blocked environment={environment} />}

			{showSoftAsk ? (
				<div className="card">
					<p>
						Gloom Watch can buzz your phone the moment a card you still need is listed — an auction
						can end before the next time you think to look.
					</p>
					<p className="muted">
						iOS asks once. If you say no here, turning it back on means a trip through Settings.
					</p>
					<div className="actions">
						<button type="button" onClick={onEnable} disabled={busy}>
							{busy ? "Asking…" : "Enable notifications"}
						</button>
						<button type="button" className="quiet" onClick={onDismiss} disabled={busy}>
							Not now
						</button>
					</div>
				</div>
			) : null}

			<dl>
				<Row label="Installed as web app" value={environment.standalone ? "yes" : "no"} />
				<Row label="Push API" value={environment.pushSupported ? "present" : "absent"} />
				<Row label="Transport" value={environment.transport} />
				<Row label="Permission" value={environment.permission} />
				<Row
					label="Subscription"
					value={registered === null ? "not registered this session" : registered.id}
				/>
			</dl>

			{result !== null && !result.ok ? (
				<p className="error">
					{FAILURE_MESSAGES[result.reason] ?? "Notifications could not be enabled."}
					{result.detail === undefined ? "" : ` (${result.detail})`}
				</p>
			) : null}
			{result?.ok === true ? (
				<p className="muted">
					Subscribed as <b>{result.subscription.transport}</b>. Send the test push from the box with{" "}
					<code>bun run push:test</code>.
				</p>
			) : null}

			{/*
			 * Permanent, and gesture-gated. iOS drops subscriptions without telling the page, so
			 * there is no state in which this button is safe to hide.
			 */}
			<div className="actions">
				<button type="button" onClick={onEnable} disabled={busy || !environment.ready}>
					{busy ? "Working…" : "Re-enable notifications"}
				</button>
			</div>
			<p className="muted">
				iOS drops push subscriptions silently and tells the app nothing. If notifications stop
				arriving, tap that.
			</p>
		</section>
	);
}
