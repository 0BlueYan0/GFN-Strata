import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { nativeFixture, finishJob } from './helpers/native-fixture.mjs';

const configOf = f => join(f.repo, 'strata-iq2_xs.json');

for (const validFirst of [true, false]) test(`a load ${validFirst ? 'uses a valid' : 'refuses an invalid'} captured config even if the file changes after reading`, async t => {
  const f = nativeFixture();
  try {
    await f.control.refresh(true);
    const path = configOf(f), good = JSON.parse(readFileSync(path, 'utf8'));
    good.parallel = 2;
    const valid = '\uFEFF' + JSON.stringify(good), invalid = JSON.stringify({ ...good, parallel: 99 });
    writeFileSync(path, validFirst ? valid : invalid);
    // Let status discovery finish normally. Replace the real file immediately after
    // the first read following the model-path check, before a second read can occur.
    const realpath = fs.realpathSync, read = fs.readFileSync;
    let capture = false;
    t.mock.method(fs, 'realpathSync', (...args) => {
      const result = realpath(...args);
      if (args[0] === path) capture = true;
      return result;
    });
    t.mock.method(fs, 'readFileSync', (...args) => {
      const result = read(...args);
      if (capture && args[0] === path) {
        capture = false;
        writeFileSync(path, validFirst ? invalid : valid);
      }
      return result;
    });
    syncBuiltinESMExports();
    const done = await finishJob(f.control, f.control.operation('load', { model: 'iq2_xs' }).id);
    assert.equal(done.state, validFirst ? 'done' : 'error', done.error);
    if (validFirst) {
      const instance = f.control.resolveInstance(done.result.instanceId);
      assert.equal(JSON.parse(read(instance.configPath, 'utf8')).parallel, 2);
    } else {
      assert.match(done.error, /"parallel" must be a whole number/);
      assert.equal(f.control.state().instances.length, 0);
      assert.equal(f.calls.some(c => c.args.some(a => /serve[/\\]server\.py$/.test(String(a)))), false);
    }
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await f.cleanup();
  }
});

test('the settings file is found, checked, and opened in the text editor', async () => {
  const f = nativeFixture();
  try {
    await f.control.refresh();
    const info = f.control.settingsFile('iq2_xs');
    assert.equal(info.path, configOf(f));
    assert.equal(info.name, 'strata-iq2_xs.json');
    assert.equal(info.ok, true);
    assert.match(info.note, /apply the next time the model starts/);
    assert.ok(info.issues.every(i => i.level === 'warning'), 'the fixture’s own extra key is a warning at most');
    const seen = [];
    const opened = await f.control.openSettingsFile('iq2_xs', { recorder: seen, platform: 'win32' });
    assert.deepEqual(seen, [['notepad.exe', info.path]]);
    assert.equal(opened.name, 'strata-iq2_xs.json');
    assert.throws(() => f.control.settingsFile('../etc/passwd'), /installed model/);
  } finally { await f.cleanup(); }
});

test('a mistake in the file holds the start back with its line; a typo’d key only warns', async () => {
  const f = nativeFixture();
  try {
    await f.control.refresh(true);
    const path = configOf(f), good = readFileSync(path, 'utf8');
    // 1. a syntax slip (missing comma): not valid JSON, said with the line, and nothing is started
    writeFileSync(path, JSON.stringify(JSON.parse(good), null, 2).replace('"gpu": 0,', '"gpu": 0\n  "x": 1,'));
    assert.equal(f.control.settingsFile('iq2_xs').ok, false);
    let done = await finishJob(f.control, f.control.operation('load', { model: 'iq2_xs' }).id);
    assert.equal(done.state, 'error');
    assert.match(done.error, /^The settings file for this model has a mistake, so the model was not started\. Line \d+: The settings file is not valid JSON/);
    assert.equal(f.control.state().instances.length, 0, 'no engine was started');
    assert.equal(f.calls.filter(c => /strata\.py|serve/.test(JSON.stringify(c.args))).length, 0);
    // 2. a bad value
    const config = JSON.parse(good); config.parallel = 99; config.lazy_load = 'yes';
    writeFileSync(path, JSON.stringify(config, null, 2));
    done = await finishJob(f.control, f.control.operation('load', { model: 'iq2_xs' }).id);
    assert.equal(done.state, 'error');
    assert.match(done.error, /"parallel" must be a whole number from 1 to 8, not 99/);
    assert.match(done.error, /"lazy_load" must be true or false, not "yes"/);
    // 3. an unknown key only warns and the model loads
    const typo = JSON.parse(good); typo.paralel = 2;
    writeFileSync(path, JSON.stringify(typo, null, 2));
    const info = f.control.settingsFile('iq2_xs');
    assert.equal(info.ok, true);
    assert.ok(info.issues.some(i => i.code === 'unknown-key-near' && i.params.near === 'parallel'));
    done = await finishJob(f.control, f.control.operation('load', { model: 'iq2_xs' }).id);
    assert.equal(done.state, 'done', done.error);
  } finally { await f.cleanup(); }
});

/* Editing the settings file inside the app (this fork): GET gives the text and its version, PUT writes the person's text as typed. */
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('the settings file text and its version are read from the file', async () => {
  const f = nativeFixture();
  try {
    await f.control.refresh();
    const info = f.control.settingsFileText('iq2_xs');
    assert.equal(info.text, readFileSync(configOf(f), 'utf8'));
    assert.equal(info.version, sha(readFileSync(configOf(f))));
    assert.equal(info.name, 'strata-iq2_xs.json');
    assert.equal(info.ok, true);
  } finally { await f.cleanup(); }
});

test('a save writes the typed text byte for byte, keeps the old file as .bak, and leaves args_written alone', async () => {
  const f = nativeFixture();
  try {
    await f.control.refresh(true);
    const path = configOf(f), config = JSON.parse(readFileSync(path, 'utf8'));
    config.args_written = [...config.args];
    writeFileSync(path, JSON.stringify(config));
    const before = readFileSync(path), first = f.control.settingsFileText('iq2_xs');
    // The person adds a hand-written flag, with their own spacing and no trailing newline.
    const typed = JSON.stringify({ ...config, args: [...config.args, '--vram-reserve-mib', '512'] }, null, 4).replace('"gpu": 0', '"gpu":   0');
    const saved = f.control.saveSettingsFileText('iq2_xs', { text: typed, version: first.version });
    assert.deepEqual(readFileSync(path), Buffer.from(typed, 'utf8'));
    assert.deepEqual(readFileSync(path + '.bak'), before);
    assert.equal(saved.text, typed);
    assert.equal(saved.version, sha(Buffer.from(typed, 'utf8')));
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).args_written, config.args_written, 'the list of the app’s own options was not refreshed');
    assert.equal(existsSync(path + '.ui-tmp'), false, 'no temporary file is left');
    // The new version saves again; the old one does not.
    f.control.saveSettingsFileText('iq2_xs', { text: typed + '\n', version: saved.version });
    assert.throws(() => f.control.saveSettingsFileText('iq2_xs', { text: typed, version: first.version }), e => e.status === 409 && e.code === 'settings-file-changed');
  } finally { await f.cleanup(); }
});

test('a mistake in the text is refused with its line and the file is not touched; a warning still saves', async () => {
  const f = nativeFixture();
  try {
    await f.control.refresh(true);
    const path = configOf(f), disk = readFileSync(path), info = f.control.settingsFileText('iq2_xs');
    const broken = JSON.stringify(JSON.parse(info.text), null, 2).replace('"gpu": 0,', '"gpu": 0\n  "x": 1,');
    assert.throws(() => f.control.saveSettingsFileText('iq2_xs', { text: broken, version: info.version }), e => {
      assert.equal(e.status, 400);
      assert.equal(e.code, 'settings-file-mistake');
      assert.ok(e.issues.some(i => i.level === 'error' && i.code === 'json' && i.line > 0), 'the issue names a line');
      return true;
    });
    const badValue = JSON.stringify({ ...JSON.parse(info.text), parallel: 99 });
    assert.throws(() => f.control.saveSettingsFileText('iq2_xs', { text: badValue, version: info.version }), e => e.status === 400 && e.issues.some(i => i.code === 'whole-range'));
    assert.deepEqual(readFileSync(path), disk, 'the file is unchanged');
    assert.equal(existsSync(path + '.bak'), false, 'nothing was backed up for a refused save');
    const typo = JSON.stringify({ ...JSON.parse(info.text), paralel: 2 });
    const saved = f.control.saveSettingsFileText('iq2_xs', { text: typo, version: info.version });
    assert.equal(saved.ok, true);
    assert.ok(saved.issues.some(i => i.level === 'warning' && i.code === 'unknown-key-near'));
    assert.equal(readFileSync(path, 'utf8'), typo);
  } finally { await f.cleanup(); }
});

test('a file that changed on disk since it was read is not overwritten (409)', async () => {
  const f = nativeFixture();
  try {
    await f.control.refresh(true);
    const path = configOf(f), info = f.control.settingsFileText('iq2_xs');
    const other = JSON.stringify({ ...JSON.parse(info.text), parallel: 3 });
    writeFileSync(path, other);   // an editor or the other settings screen got there first
    assert.throws(() => f.control.saveSettingsFileText('iq2_xs', { text: info.text, version: info.version }), e => e.status === 409 && /changed since you opened it/.test(e.message));
    assert.throws(() => f.control.saveSettingsFileText('iq2_xs', { text: info.text }), e => e.status === 409, 'no version at all counts as not matching');
    assert.equal(readFileSync(path, 'utf8'), other);
    assert.equal(existsSync(path + '.bak'), false);
    assert.throws(() => f.control.saveSettingsFileText('iq2_xs', { version: info.version }), /text is missing/);
  } finally { await f.cleanup(); }
});

test('a file outside the installation folder, or a model that is not installed, is refused', async () => {
  const f = nativeFixture();
  try {
    await f.control.refresh(true);
    assert.throws(() => f.control.settingsFileText('../etc/passwd'), /installed model/);
    assert.throws(() => f.control.saveSettingsFileText('../etc/passwd', { text: '{}', version: 'x' }), /installed model/);
    assert.throws(() => f.control.saveSettingsFileText('nope', { text: '{}', version: 'x' }), /not installed/);
    const outside = join(f.directory, 'strata-iq2_xs.json');
    writeFileSync(outside, '{"gpu":0}');
    f.installed.models[0].configPath = outside;
    await f.control.refresh(true);
    assert.throws(() => f.control.settingsFileText('iq2_xs'), /outside the Strata installation/);
    assert.throws(() => f.control.saveSettingsFileText('iq2_xs', { text: '{"gpu":1}', version: sha(readFileSync(outside)) }), /outside the Strata installation/);
    assert.equal(readFileSync(outside, 'utf8'), '{"gpu":0}');
  } finally { await f.cleanup(); }
});

test('no save while an operation is running or the model has a request in flight', async () => {
  const f = nativeFixture();
  try {
    await f.control.refresh(true);
    const path = configOf(f), info = f.control.settingsFileText('iq2_xs');
    const job = f.control.operation('load', { model: 'iq2_xs' });
    assert.throws(() => f.control.saveSettingsFileText('iq2_xs', { text: info.text, version: info.version }), /Finish the current operation/);
    const done = await finishJob(f.control, job.id);
    assert.equal(done.state, 'done', done.error);
    const disk = readFileSync(path);
    f.requests.push({ instanceId: done.result.instanceId, state: 'generating' });
    assert.throws(() => f.control.saveSettingsFileText('iq2_xs', { text: info.text, version: sha(disk) }), /Finish this model’s requests/);
    assert.deepEqual(readFileSync(path), disk);
    f.requests.length = 0;
  } finally { await f.cleanup(); }
});

test('the sentences the host sends for this screen each have a key and a translation in every language', () => {
  const langs = ['de', 'es', 'fr', 'he', 'ja', 'ko', 'pt', 'ru', 'zh'];
  const read = l => JSON.parse(readFileSync(new URL(`../src/locales/gfn-${l}.json`, import.meta.url), 'utf8'));
  const en = read('en'), source = readFileSync(new URL('../server/native-control.mjs', import.meta.url), 'utf8');
  for (const sentence of ['The settings file was changed since you opened it. Load it again to see the new version.', 'The settings file was not saved because it has a mistake.', 'The settings file text is missing.']) {
    assert.ok(source.includes(`'${sentence}'`), `the host still says: ${sentence}`);
    const id = Object.entries(en).find(([, v]) => v === sentence)?.[0];
    assert.ok(id, `"${sentence}" has a key`);
    for (const l of langs) assert.ok(read(l)[id] && read(l)[id] !== sentence, `${l}: ${sentence}`);
  }
});

// The screen has no test that renders it, so this checks the source: the 409 notice must ask before it replaces the text the person typed.
test('the reload after a 409 asks first, and its three sentences have keys and translations', () => {
  const tsx = readFileSync(new URL('../src/components/NativeSettingsFile.tsx', import.meta.url), 'utf8');
  assert.match(tsx, /onRetry=\{\(\) => setReplacing\(true\)\}/, 'the notice only opens the question');
  assert.doesNotMatch(tsx, /onRetry=\{\(\) => void load\(\)\}/, 'the notice does not load by itself');
  assert.match(tsx, /<Btn onClick=\{\(\) => setReplacing\(false\)\}>\{tr\("Keep my changes"\)\}<\/Btn>/, 'cancel leaves the text as it is');
  assert.match(tsx, /variant="danger"[^>]*onClick=\{\(\) => void load\(\)\.then\(\(\) => setReplacing\(false\)\)\}/, 'only the confirm button loads');
  const read = l => JSON.parse(readFileSync(new URL(`../src/locales/gfn-${l}.json`, import.meta.url), 'utf8'));
  const en = read('en');
  for (const sentence of ['Replace your changes?', 'Keep my changes', 'Loading the file again replaces the changes you typed with the version on the disk.']) {
    assert.ok(tsx.includes(`tr("${sentence}")`), `the screen says: ${sentence}`);
    const id = Object.entries(en).find(([, v]) => v === sentence)?.[0];
    assert.ok(id, `"${sentence}" has a key`);
    for (const l of ['de', 'es', 'fr', 'he', 'ja', 'ko', 'pt', 'ru', 'zh']) assert.ok(read(l)[id] && read(l)[id] !== sentence, `${l}: ${sentence}`);
  }
});
