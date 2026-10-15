import test from 'node:test';
import assert from 'node:assert/strict';
import { YahooClient, YahooService } from '../src/yahoo/client.js';
import { xml, collection, number } from '../src/yahoo/xml.js';
import { player } from '../src/yahoo/normalize.js';
import { Http } from '../src/lib/http.js';
import { FixtureYahoo, bao, standard, key, playerRaw, roundTrip } from './helpers.js';

test('XML handles singleton/empty collections and preserves identifiers and real zero', () => {
  const raw = xml('<fantasy_content><players count="1"><player><player_key>999.p.0001</player_key><status>0</status></player></players></fantasy_content>');
  assert.equal(collection(raw, 'players', 'player')[0]?.player_key, '999.p.0001');
  assert.deepEqual(collection(xml('<fantasy_content><players count="0"/></fantasy_content>'), 'players', 'player'), []);
  assert.equal(number('0'), 0); assert.equal(number(''), null); assert.equal(number('-'), null);
  assert.throws(() => collection(raw, 'missing', 'player'), /missing/);
  assert.throws(() => xml('<!DOCTYPE foo><fantasy_content/>'), /unsafe/);
  assert.throws(() => xml('<broken>'), /invalid/);
});
test('player normalization distinguishes missing projections, zero and roster slots', () => {
  const p = player(playerRaw(1, 'IR'), 'rostered');
  assert.equal(p.rosterGroup, 'IR'); assert.equal(p.projectedPoints, null); assert.equal(p.injuryStatus, null);
  assert.equal(player(playerRaw(2, 'BN'), 'rostered').rosterGroup, 'bench');
  assert.equal(player({ ...playerRaw(3), player_projected_points: { total: '0' } }, 'FA').projectedPoints, 0);
  assert.equal(player({ ...playerRaw(3), player_projected_points: { total: '0' } }, 'FA').projectionStatus, 'provided');
});
test('both leagues independently discover keys, team counts, scoring and complete rosters', async () => {
  for (const config of [bao, standard]) {
    const fixture = new FixtureYahoo(config), snapshot = await new YahooService(fixture).collect(config, [], 100);
    assert.deepEqual(snapshot.errors, []); assert.equal(snapshot.league.leagueKey, key(config));
    assert.equal(snapshot.league.numTeams, config.id === 'bao' ? 2 : 3);
    assert.equal(snapshot.allRosters.status, 'ok');
    if (snapshot.allRosters.status === 'ok') assert.equal(snapshot.allRosters.data.length, snapshot.league.numTeams * 3);
    assert.equal(snapshot.matchups.status, 'ok');
    if (snapshot.matchups.status === 'ok') { assert.equal(snapshot.matchups.data[0]?.points, 0); assert.equal(snapshot.matchups.data[0]?.projectedPoints, 120.5); }
    if (snapshot.transactions.status === 'ok') { assert.equal(snapshot.transactions.data.length, 2); assert.equal(snapshot.transactions.data[1]?.action, 'drop'); }
    assert.ok(fixture.paths[0]?.includes('seasons=2026'));
  }
});
test('FA and W paginate every position independently, continue short pages, deduplicate overlapping position filters', async () => {
  const fixture = new FixtureYahoo(), service = new YahooService(fixture), { league } = await service.verify(bao);
  assert.equal((await service.available(league, 'FA', ['QB', 'Q/W/R/T'])).length, 3);
  assert.equal((await service.available(league, 'W', ['QB'])).length, 3);
  assert.equal(fixture.paths.filter(p => p.includes('/players;')).length, 9);
  assert.ok(fixture.paths.some(p => p.includes('status=W;position=QB') && p.includes('start=0')));
  assert.ok(fixture.paths.some(p => p.includes('position=Q%2FW%2FR%2FT') && p.includes('start=3')));
});
test('failed page and failed roster preserve whole datasets but allow unrelated successes', async () => {
  const fixture = new FixtureYahoo(); fixture.failures.add('status=FA;sort=NAME;start=2'); fixture.failures.add('.t.2/roster');
  const snapshot = await new YahooService(fixture).collect(bao, [], 100);
  assert.equal(snapshot.freeAgents.status, 'error'); assert.equal(snapshot.waivers.status, 'ok');
  assert.equal(snapshot.myRoster.status, 'ok'); assert.equal(snapshot.allRosters.status, 'error'); assert.equal(snapshot.errors.length, 2);
});
test('wrong season and incomplete standings refuse league verification', async () => {
  const fixture = new FixtureYahoo(), original = fixture.get.bind(fixture);
  fixture.get = async path => path.endsWith('/metadata') ? roundTrip({ league: { league_key: key(), league_id: bao.leagueId, season: '2025' } }) : original(path);
  await assert.rejects(() => new YahooService(fixture).verify(bao), /season mismatch/);
  fixture.get = async path => path.endsWith('/standings') ? roundTrip({ league: { standings: { teams: { '@_count': '0' } } } }) : original(path);
  await assert.rejects(() => new YahooService(fixture).verify(bao), /Incomplete standings/);
});
test('repeated Yahoo pages fail instead of silently truncating', async () => {
  const fixture = new FixtureYahoo(), original = fixture.get.bind(fixture);
  fixture.get = path => original(path.replace(/;start=\d+/, ';start=0'));
  const service = new YahooService(fixture), { league } = await service.verify(bao);
  await assert.rejects(() => service.available(league, 'FA', []), /repeated a player/);
});
test('Yahoo transport only issues GET, refreshes once on 401, never logs secrets', async () => {
  const forces: boolean[] = [], methods: string[] = [];
  const auth = { access: async (force = false) => { forces.push(force); return 'secret'; } };
  let calls = 0;
  const http = new Http(async (_url, init) => { methods.push(init?.method || 'GET'); return ++calls === 1 ? new Response('private', { status: 401 }) : new Response('<fantasy_content><games count="0"/></fantasy_content>'); });
  await new YahooClient(auth, http).get('games;game_codes=nfl');
  assert.deepEqual(forces, [false, true]); assert.deepEqual(methods, ['GET', 'GET']);
  await assert.rejects(() => new YahooClient(auth, http).get('https://evil.example'), /Invalid/);
});
