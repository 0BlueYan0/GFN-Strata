/** Where the host keeps its data: the Windows default is %LOCALAPPDATA%\Strata\home, an existing ~\.strata keeps being used. Pure rules plus one real import. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { homeCandidates } from '../server/store.mjs';

const WIN = { platform: 'win32', home: 'C:\\Users\\kiosk', cwd: 'C:\\Strata\\host' };
const LOCAL = 'C:\\Users\\kiosk\\AppData\\Local';
const FRESH = win32.join(LOCAL, 'Strata', 'home');
const LEGACY = win32.join(WIN.home, '.strata');
const CWD_HOME = win32.join(WIN.cwd, '.strata');
const withState = (...dirs) => dir => dirs.includes(dir);

test('STRATA_HOME comes first, then the old places, on every platform', () => {
  assert.deepEqual(
    homeCandidates({ ...WIN, env: { STRATA_HOME: 'D:\\x', LOCALAPPDATA: LOCAL }, hasState: withState() }),
    ['D:\\x', LEGACY, CWD_HOME],
  );
  assert.deepEqual(
    homeCandidates({ platform: 'linux', home: '/home/u', cwd: '/srv/host', env: { STRATA_HOME: '/data/x' }, hasState: withState() }),
    ['/data/x', '/home/u/.strata', '/srv/host/.strata'],
  );
});

test('Linux and Mac keep ~/.strata, even when LOCALAPPDATA is set', () => {
  for (const platform of ['linux', 'darwin']) {
    assert.deepEqual(
      homeCandidates({ platform, home: '/home/u', cwd: '/srv/host', env: { LOCALAPPDATA: '/somewhere' }, hasState: withState() }),
      ['/home/u/.strata', '/srv/host/.strata'],
    );
  }
});

test('Windows without an absolute LOCALAPPDATA keeps ~\\.strata', () => {
  for (const LOCALAPPDATA of [undefined, '', 'relative\\Local']) {
    assert.deepEqual(homeCandidates({ ...WIN, env: { LOCALAPPDATA }, hasState: withState(LEGACY) }), [LEGACY, CWD_HOME]);
  }
});

test('Windows with no state in either place uses %LOCALAPPDATA%\\Strata\\home first', () => {
  assert.deepEqual(homeCandidates({ ...WIN, env: { LOCALAPPDATA: LOCAL }, hasState: withState() }), [FRESH, LEGACY, CWD_HOME]);
});

test('Windows where only ~\\.strata has state keeps using it', () => {
  assert.deepEqual(homeCandidates({ ...WIN, env: { LOCALAPPDATA: LOCAL }, hasState: withState(LEGACY) }), [LEGACY, FRESH, CWD_HOME]);
});

test('Windows where only the new place has state uses it', () => {
  assert.deepEqual(homeCandidates({ ...WIN, env: { LOCALAPPDATA: LOCAL }, hasState: withState(FRESH) }), [FRESH, LEGACY, CWD_HOME]);
});

test('Windows where both places have state uses the new place', () => {
  assert.deepEqual(homeCandidates({ ...WIN, env: { LOCALAPPDATA: LOCAL }, hasState: withState(FRESH, LEGACY) }), [FRESH, LEGACY, CWD_HOME]);
});

test('the default hasState looks for data\\state.json inside the folder', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'strata-home-rules-'));
  try {
    // Only the shape of the result matters here: the real folders do not exist, so nothing has state and the new place wins.
    const [first] = homeCandidates({ platform: 'win32', home: join(scratch, 'user'), cwd: scratch, env: { LOCALAPPDATA: scratch } });
    assert.equal(first, win32.join(scratch, 'Strata', 'home'));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('importing store.mjs on Windows without STRATA_HOME makes Strata\\home with data and models inside', { skip: process.platform !== 'win32' }, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'strata-home-import-'));
  try {
    const profile = join(scratch, 'profile');
    const local = join(scratch, 'Local');
    const cwd = join(scratch, 'cwd');
    for (const dir of [profile, local, cwd, join(scratch, 'Documents')]) mkdirSync(dir, { recursive: true });
    const env = { ...process.env, USERPROFILE: profile, HOME: profile, LOCALAPPDATA: local, STRATA_DOCUMENTS_DIR: join(scratch, 'Documents') };
    for (const name of ['STRATA_HOME', 'STRATA_MODELS_DIR']) delete env[name];
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {HOME,DATA_DIR} from ${JSON.stringify(new URL('../server/store.mjs', import.meta.url).href)};console.log(JSON.stringify({HOME,DATA_DIR}))`], { cwd, env, encoding: 'utf8', timeout: 60000 });
    assert.equal(child.status, 0, child.stderr);
    const out = JSON.parse(child.stdout.trim().split(/\r?\n/).pop());
    const expected = join(local, 'Strata', 'home');
    assert.equal(out.HOME, expected);
    assert.equal(out.DATA_DIR, join(expected, 'data'));
    assert.ok(existsSync(join(expected, 'data')), 'data folder was made');
    assert.ok(existsSync(join(expected, 'models')), 'models folder was made');
    assert.equal(existsSync(join(profile, '.strata')), false, 'the old place was not created');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
