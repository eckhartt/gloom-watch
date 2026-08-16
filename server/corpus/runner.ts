/**
 * How a corpus sync actually runs in the server process.
 *
 * The spec makes the sync a job rather than a request. It is **not** an OS-level `Bun.cron`
 * entry, and deliberately so: cron jobs are the ones that must run without anybody present —
 * the scanner, the digests, the backup — and the spec fixes corpus refresh as *manual*, so
 * there is no schedule to register. What matters is that pressing sync does not hold an HTTP
 * connection open, and that the record of the run survives a restart. Both come from the job
 * row, not from where the code executes.
 *
 * It runs in the HTTP server's process on the HTTP server's connection. The one-connection-per-
 * process rule is therefore satisfied for free, and none of the environment-file trap applies:
 * this job reads no secrets. The module is also runnable on its own from the command line
 * (`bun run corpus:sync`), which is how it gets driven on the box without a phone.
 */

import type { GloomDatabase } from "../db/client.ts";
import type { CorpusSyncStarter } from "./http.ts";
import { runCorpusSync } from "./sync.ts";
import { HttpTcgdexClient } from "./tcgdex.ts";

/**
 * Fire and forget: the route has already written the job row, so failure has somewhere durable
 * to land and nothing is lost by not awaiting this. An unhandled rejection here would take the
 * server down, which is why the promise is caught even though `runCorpusSync` records its own
 * failures.
 */
export function defaultCorpusSyncStarter(db: GloomDatabase): CorpusSyncStarter {
	return (jobId: string) => {
		void runCorpusSync({ db, client: new HttpTcgdexClient(), log: (m) => console.log(m) }, jobId)
			.then((summary) => {
				console.log(
					`corpus sync ${summary.status}: ${summary.cardsUpserted} card(s), ` +
						`${summary.variantsUpserted} variant(s), ${summary.imagesFetched} image(s), ` +
						`${summary.variantsFlaggedMissing} flagged missing`,
				);
			})
			.catch((error: unknown) => {
				console.error(`corpus sync ${jobId} threw outside its own error handling:`, error);
			});
	};
}
