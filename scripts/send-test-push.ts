/**
 * Send a test push, by hand, from the server. The demo for the push-transport ticket.
 *
 *   bun run push:test
 *   bun run push:test --title "Gloom" --body "check" --navigate /
 *   bun run push:test --dry-run          # print what would be sent, send nothing
 *
 * **Run it on the box, not on a development machine.** A push subscription keys to the origin and
 * the service worker's scope, so a subscription taken on `https://htpc.tail594f35.ts.net` can only
 * be exercised from the server holding that origin's VAPID private key.
 *
 * **It loads the environment file explicitly.** Run under cron, or by hand from a shell that
 * never sourced it, this process inherits none of systemd's `EnvironmentFile` — and
 * `VAPID_PRIVATE_KEY` is precisely the variable whose absence looks like nothing at all.
 * `loadVapidConfig` does that load; this script does not depend on the caller's environment.
 *
 * The private key is never printed. `--dry-run` shows the payload, its size and the endpoint
 * host, and nothing else.
 */

import { loadConfig } from "../server/config.ts";
import { openDatabase } from "../server/db/client.ts";
import { applyMigrations } from "../server/db/migrate.ts";
import { sendPushToSubscription } from "../server/push/send.ts";
import { listLiveSubscriptions } from "../server/push/subscriptions.ts";
import { loadVapidConfig } from "../server/push/vapid.ts";
import type { PushNotificationContent } from "../shared/push.ts";
import { resolveNavigateTarget, serialisePushPayload } from "../shared/push.ts";

function flag(name: string, fallback: string): string {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1) return fallback;
	return process.argv[index + 1] ?? fallback;
}

const dryRun = process.argv.includes("--dry-run");
const config = loadConfig();

if ((process.env.GLOOM_WATCH_ORIGIN ?? "") === "") {
	console.error(
		[
			"GLOOM_WATCH_ORIGIN is not set, so the notification's tap target would point at",
			`${config.publicOrigin} — a loopback address the phone cannot reach.`,
			"",
			"Set it to the Tailscale Serve origin (https://<host>.<tailnet>.ts.net) in",
			"/etc/gloom-watch/gloom-watch.env and try again. A push that buzzes and then opens",
			"nothing has spent the owner's attention for nothing.",
		].join("\n"),
	);
	process.exit(1);
}

const content: PushNotificationContent = {
	title: flag("title", "Gloom Watch"),
	body: flag("body", "Test push — the transport works."),
	navigate: resolveNavigateTarget(config.publicOrigin, flag("navigate", "/")),
	lang: "en-AU",
};

const handle = openDatabase(config.databasePath);
try {
	applyMigrations(handle, config.migrationsDir);
	const subscriptions = listLiveSubscriptions(handle.db);

	if (subscriptions.length === 0) {
		console.error(
			[
				"No live push subscriptions are registered.",
				"",
				"Open the app on the iPhone from its Home Screen icon and use the notifications",
				"section to enable them. The subscription is posted to the server as it is taken.",
			].join("\n"),
		);
		process.exit(1);
	}

	console.log(`origin      ${config.publicOrigin}`);
	console.log(`navigate    ${content.navigate}`);
	console.log(`title       ${content.title}`);
	console.log(`body        ${content.body}`);

	for (const subscription of subscriptions) {
		const preview = serialisePushPayload(content, subscription.transport);
		console.log(
			`\nsubscription ${subscription.id}  transport=${subscription.transport}  ` +
				`bytes=${preview.bytes}  endpoint=${new URL(subscription.endpoint).host}`,
		);
		console.log(`payload      ${preview.body}`);

		if (dryRun) continue;

		// Reads the environment file itself when the environment does not already carry the keys.
		const vapid = loadVapidConfig();
		const outcome = await sendPushToSubscription({ db: handle.db, vapid }, subscription, {
			content,
			kind: "test",
		});

		console.log(
			`result       status=${outcome.statusCode ?? "none"} accepted=${outcome.accepted} ` +
				`retired=${outcome.retired} echo=${outcome.echoId}` +
				(outcome.error === null ? "" : ` error=${outcome.error}`),
		);
	}

	if (dryRun) {
		console.log("\n--dry-run: nothing was sent.");
	} else {
		console.log(
			[
				"",
				"A 201 means the push service accepted the message. It does not mean the phone",
				"displayed it — nothing server-side can observe that. Look at the handset.",
			].join("\n"),
		);
	}
} finally {
	handle.close();
}
