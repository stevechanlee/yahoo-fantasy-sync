import { mkdir } from 'node:fs/promises';
import { Command, Option } from 'commander';
import lockfile from 'proper-lockfile';
import { configuration } from './config.js';
import { oauth } from './auth.js';
import { YahooClient, YahooService } from './yahoo/client.js';
import { GoogleClient } from './google/client.js';
import { SheetsSync } from './google/sync.js';
import { synchronize } from './sync.js';

async function locked(fn: () => Promise<void>): Promise<void> {
  const config = configuration();
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  let release: () => Promise<void>;
  try { release = await lockfile.lock(config.dataDir, { realpath: false, stale: 60_000, update: 10_000, retries: 0 }); }
  catch { throw new Error('Another yahoo-fantasy-sync process holds the local lock. Wait for it to finish, then retry.'); }
  try { await fn(); } finally { await release(); }
}
const program = new Command().name('yahoo-fantasy-sync').description('Read-only Yahoo Fantasy Football → dedicated Google Sheets').version('1.0.0');
program.command('auth').argument('<provider>', 'yahoo or google').action(async (provider: string) => {
  if (provider !== 'yahoo' && provider !== 'google') throw new Error('Provider must be yahoo or google');
  await locked(async () => (await oauth(provider)).authorize());
});
const leagueOption = () => new Option('--league <league>', 'limit to one league').choices(['bao', 'standard']);
program.command('verify-yahoo').description('Fetch, validate and export both leagues; no Google writes').addOption(leagueOption()).action(async (args: { league?: string }) => {
  await locked(async () => {
    const config = configuration(), auth = await oauth('yahoo');
    await auth.access();
    const yahoo = new YahooService(new YahooClient(auth), console.log);
    const reports = await synchronize({ ...config, leagues: config.leagues.filter(l => !args.league || l.id === args.league) }, yahoo);
    if (reports.some(r => r.status !== 'complete')) process.exitCode = 1;
  });
});
program.command('verify-google').description('Verify Google Sheets access without creating files').action(async () => {
  await locked(async () => {
    const config = configuration(), auth = await oauth('google');
    await auth.access(); await new SheetsSync(new GoogleClient(auth), config.dataDir).verify();
    console.log('Google OAuth and Sheets API connectivity verified. No files created.');
  });
});
program.command('sync').addOption(leagueOption()).action(async (args: { league?: string }) => {
  await locked(async () => {
    const config = configuration(), yahooAuth = await oauth('yahoo');
    await yahooAuth.access();
    const googleAuth = await oauth('google'); await googleAuth.access();
    const yahoo = new YahooService(new YahooClient(yahooAuth), console.log), sheets = new SheetsSync(new GoogleClient(googleAuth), config.dataDir);
    const reports = await synchronize({ ...config, leagues: config.leagues.filter(l => !args.league || l.id === args.league) }, yahoo, sheets);
    if (reports.some(r => r.status !== 'complete')) process.exitCode = 1;
  });
});
program.parseAsync().catch(error => { console.error(error instanceof Error ? error.message : 'Unexpected application error'); process.exitCode = 1; });
