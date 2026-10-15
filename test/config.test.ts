import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration } from '../src/config.js';
import { bao, standard } from './helpers.js';

const env = {
  BAO_LEAGUE_ID: bao.leagueId, BAO_LEAGUE_NAME: bao.name, BAO_SPREADSHEET_TITLE: bao.title,
  STANDARD_LEAGUE_ID: standard.leagueId, STANDARD_LEAGUE_NAME: standard.name, STANDARD_SPREADSHEET_TITLE: standard.title,
};
test('personal league identities and titles come exclusively from supplied environment', () => {
  assert.deepEqual(configuration(env).leagues, [bao, standard].map(l => ({ ...l, spreadsheetId: undefined, teamKey: undefined })));
  const changed = configuration({ ...env, BAO_LEAGUE_NAME: 'Another private name', BAO_SPREADSHEET_TITLE: 'Another private title' });
  assert.equal(changed.leagues[0]?.name, 'Another private name'); assert.equal(changed.leagues[0]?.title, 'Another private title');
});
test('missing or invalid local configuration fails without echoing private values', () => {
  assert.throws(() => configuration({}), /Configure BAO_LEAGUE_ID/);
  assert.throws(() => configuration({ ...env, STANDARD_LEAGUE_NAME: '' }), /Configure STANDARD_LEAGUE_NAME/);
  assert.throws(() => configuration({ ...env, BAO_LEAGUE_ID: 'private-invalid-value' }), error => error instanceof Error && error.message.includes('BAO_LEAGUE_ID') && !error.message.includes('private-invalid-value'));
});
test('duplicate league IDs and spreadsheet IDs are rejected', () => {
  assert.throws(() => configuration({ ...env, STANDARD_LEAGUE_ID: env.BAO_LEAGUE_ID }), /different Yahoo league ID/);
  assert.throws(() => configuration({ ...env, BAO_SPREADSHEET_ID: 'same-id', STANDARD_SPREADSHEET_ID: 'same-id' }), /different spreadsheet/);
});
