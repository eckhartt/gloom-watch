import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.ts";
import { beginCorpusSync, runCorpusSync } from "../corpus/sync.ts";
import { HttpTcgdexClient } from "../corpus/tcgdex.ts";
import { processDatabase } from "../db/client.ts";
import { applyMigrations } from "../db/migrate.ts";

/**
 * `bun run corpus:sync` — run a corpus sync from the command line.
 *
 * The same job the sync button starts, in its own process with its own SQLite connection. It
 * exists because commissioning the corpus on the box should not require a phone, and because a
 * sync that fails is far easier to read here than through a polling endpoint.
 *
 * It reads no secrets, so the environment-file trap carried forward from the skeleton — a
 * scheduled process does not inherit systemd's `EnvironmentFile` — does not bite. Paths resolve
 * against the repository root through `server/config.ts` as everything else does.
 */
async function main(): Promise<void> {
	const config = loadConfig();
	const handle = processDatabase(config.databasePath);
	applyMigrations(handle, config.migrationsDir);

	const jobId = beginCorpusSync(handle.db, Date.now());
	console.log(`corpus sync ${jobId} starting against ${config.databasePath}`);

	const summary = await runCorpusSync(
		{ db: handle.db, client: new HttpTcgdexClient(), log: (message) => console.log(message) },
		jobId,
	);

	console.log(
		[
			`status              ${summary.status}`,
			`languages derived   ${summary.languagesDerived.length} (${summary.languagesDerived.join(" ")})`,
			`languages synced    ${summary.languagesSynced.length} (${summary.languagesSynced.join(" ")})`,
			`brief records       ${summary.briefRecords}`,
			`members             ${summary.members}`,
			`cards upserted      ${summary.cardsUpserted}`,
			`variants upserted   ${summary.variantsUpserted}`,
			`flagged missing     ${summary.cardsFlaggedMissing} card(s), ${summary.variantsFlaggedMissing} variant(s)`,
			`images fetched      ${summary.imagesFetched} (${(summary.imageBytesFetched / 1048576).toFixed(2)} MiB)`,
			`images unchanged    ${summary.imagesUnchanged}`,
			`variant count       ${summary.variantCountBefore} -> ${summary.variantCountAfter}`,
			`failures            ${summary.failures.length}`,
		].join("\n"),
	);
	for (const failure of summary.failures.slice(0, 20)) console.log(`  ! ${failure}`);
	if (summary.unknownAxisValues.length > 0) {
		const distinct = new Set(summary.unknownAxisValues.map((v) => `${v.axis}=${v.raw}`));
		console.log(`unknown axis values ${distinct.size}: ${[...distinct].join(", ")}`);
	}

	handle.close();
	if (summary.status === "failed") process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
