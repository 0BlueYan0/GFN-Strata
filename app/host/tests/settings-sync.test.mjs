/**
 * The expert settings, the control vector and the settings file read one file each and write it (NativeSettings sends its whole copy back). A save in one
 * must make the other two read the file again, or the expert settings' next save puts the old arguments back (final review, finding 1).
 *
 * There is no component test setup in this repo (no DOM, no React renderer, and no new package may be added), so this is checked in two ways:
 *  - `ownSave`, the rule that decides whether a component reads again, is a plain function: it is bundled with esbuild (already used by locale-gaps.test.mjs)
 *    and run, to see who reads again after whose save;
 *  - the wiring (the counter in NativeModels, each component's read effect depending on it, each save telling the others) is read from the source,
 *    like native-settings-file.test.mjs reads its sources. It shows the pieces are connected, it does not run them.
 * The server half (what a save writes when its copy is old) is the unchanged save() of server/native-control.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const src = name => readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// Everything NativeControlVector.tsx imports (React, the api client, the other components) is replaced by an empty stand-in: only its two plain functions run here.
const standIn = { name: 'stand-in', setup(b) {
  b.onResolve({ filter: /.*/ }, args => (args.kind === 'entry-point' || /NativeControlVector\.tsx$/.test(args.path) || args.path === './src/components/NativeControlVector') ? undefined : { path: args.path, namespace: 'stand-in' });
  b.onLoad({ filter: /.*/, namespace: 'stand-in' }, () => ({ contents: 'module.exports = new Proxy(function () {}, { get: () => () => undefined });', loader: 'js' }));
} };
const bundled = await build({
  stdin: { contents: "export { ownSave, noSettingsSync } from './src/components/NativeControlVector';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', plugins: [standIn],
});
const { ownSave, noSettingsSync } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

/** What NativeModels does with the counter, and what a component does in its effect, in the order they happen. */
function screen(names) {
  let sync = noSettingsSync;
  const refs = Object.fromEntries(names.map(n => [n, { current: sync.count }]));
  const reads = Object.fromEntries(names.map(n => [n, 0]));
  const effect = () => { for (const n of names) if (!ownSave(refs[n], sync, n)) reads[n]++; };
  return {
    reads,
    saved: source => { sync = { count: sync.count + 1, source }; effect(); },
    changeModel: () => { for (const n of names) reads[n]++; },
  };
}
const NAMES = ['settings', 'control-vector', 'settings-file'];

test('a save makes the other two components read the file again and not the one that saved (its "Saved" notice stays)', () => {
  for (const source of NAMES) {
    const s = screen(NAMES);
    s.saved(source);
    for (const n of NAMES) assert.equal(s.reads[n], n === source ? 0 : 1, `${source} saved, ${n} reads ${s.reads[n]} time(s)`);
  }
});

test('the order of the final review: the control vector saves, then the expert settings read again, so their save sends the file\'s arguments', () => {
  const s = screen(NAMES);
  s.saved('control-vector');
  assert.equal(s.reads.settings, 1, 'the expert settings read the file after the control vector saved');
  s.saved('settings');
  assert.equal(s.reads['control-vector'], 1, 'and the control vector block shows what the expert settings saved');
  assert.equal(s.reads.settings, 1, 'the expert settings do not read again after their own save');
  s.saved('settings-file');
  assert.deepEqual([s.reads.settings, s.reads['control-vector'], s.reads['settings-file']], [2, 2, 2]);
});

test('a component mounted after saves started, and a change of model, read as before', () => {
  const late = { current: 5 };
  assert.equal(ownSave(late, { count: 5, source: 'settings' }, 'settings'), false, 'a remount reads the file');
  const handled = { current: 0 };
  assert.equal(ownSave(handled, { count: 1, source: 'settings' }, 'settings'), true);
  assert.equal(ownSave(handled, { count: 1, source: 'settings' }, 'settings'), false, 'the same count again (a model change) reads');
});

test('NativeModels keeps the counter and hands it to all three components', () => {
  const models = src('NativeModels');
  assert.match(models, /const \[settingsSync, setSettingsSync\] = useState<SettingsSync>\(noSettingsSync\);/);
  assert.match(models, /const settingsSaved = \(source: string\) => setSettingsSync\(s => \(\{ count: s\.count \+ 1, source \}\)\);/);
  for (const name of ['NativeControlVector', 'NativeSettingsFile', 'NativeSettings'])
    assert.ok(models.includes(`<${name} model={installed.model} sync={settingsSync} onSaved={settingsSaved}/>`), `${name} gets the counter and the callback`);
});

test('each component reads again when the counter moves, skips its own save, and tells the others after a successful save', () => {
  const settings = src('NativeSettings'), vector = src('NativeControlVector'), file = src('NativeSettingsFile');
  assert.match(settings, /if \(ownSave\(handled, sync, 'settings'\) && !reading\.current\)\n\s+return;/);
  assert.match(settings, /\}, \[model,revision,sync\.count\]\);/);
  assert.ok(settings.includes("onSaved?.('settings');"), 'a successful save tells the others');
  assert.match(settings, /reading\.current = true;\n\s+setOriginal\(''\);/, 'a read in the air is marked before the state is cleared');
  assert.match(settings, /setOriginal\(JSON\.stringify\(\{ values: value\.values, mcp: value\.mcp \?\? \{\} \}\)\);\n\s+reading\.current = false;/, 'and unmarked when it came back');
  assert.match(settings, /setError\(e\.message\);\n\s+reading\.current = false;/, 'or failed');
  assert.match(vector, /if \(ownSave\(handled, sync, 'control-vector'\)\)\n\s+return;/);
  assert.match(vector, /\}, \[load, sync\.count\]\);/);
  assert.match(vector, /setSaved\(true\);\n\s+onSaved\?\.\('control-vector'\);/);
  assert.match(file, /if \(!ownSave\(handled, sync, 'settings-file'\)\)\n\s+void check\(\);/);
  assert.match(file, /\}, \[check, sync\.count\]\);/);
  assert.match(file, /setSaved\(true\);\n\s+void check\(\);\n\s+onSaved\?\.\('settings-file'\);/);
});

test('the settings file window reads the file every time it opens, so a save elsewhere is never edited over', () => {
  const file = src('NativeSettingsFile');
  assert.match(file, /async function openEditor\(\) \{\n\s+setSaved\(false\);\n\s+if \(await load\(\)\)\n\s+setOpen\(true\);/);
  assert.ok(file.includes('/settings-file/text`);\n            setText(value.text);\n            setVersion(value.version);'));
});

test('the settings component\'s only save is the one that sends its copy back, and the call that tells the others comes after it succeeded', () => {
  const settings = src('NativeSettings');
  assert.equal((settings.match(/api\.patch</g) ?? []).length, 1);
  assert.ok(settings.indexOf('api.patch<') < settings.indexOf("onSaved?.('settings')"));
  assert.ok(settings.includes("setNotice('Saved. Load the model again"), 'the notice of its own save is still set');
});

/**
 * NativeSettings' effect as the component runs it. A new run cancels the read of the run before (the cleanup), clears the screen and starts a read, and only a
 * read that was not cancelled fills the screen again. A run that returns early has no read of its own, but React has already run the cleanup of the run before.
 * `guard` is the `&& !reading.current` of the fix.
 * This is a second copy of the effect's logic written for the test: it does not read NativeSettings.tsx, and `guard` is given by the test itself. So it shows that
 * the rule is right (with the guard the screen is filled, without it the screen stays empty), not that the source has the guard. When `!reading.current` is
 * taken out of NativeSettings.tsx, the test that fails is the regular-expression check of the wiring in this same file ("each component reads again when the
 * counter moves..."), which matches `if (ownSave(handled, sync, 'settings') && !reading.current)`.
 */
function settingsComponent({ guard }) {
  const handled = { current: 0 }, c = { original: 'FILE', reading: false, active: null, started: 0 };
  const run = sync => {
    if (c.active && sync.count !== handled.current) c.active.live = false;   // React runs the cleanup of the run before, whether this run reads or not
    if (ownSave(handled, sync, 'settings') && !(guard && c.reading)) return undefined;
    const mine = { live: true };
    c.active = mine;
    c.original = '';
    c.reading = true;
    c.started++;
    return () => { if (mine.live) { c.original = 'FILE'; c.reading = false; } };   // the answer of the read
  };
  return { c, run };
}

test('the expert settings\' own save, arriving while a read that another component\'s save started is still on its way, reads again and does not leave the screen empty', () => {
  for (const guard of [true, false]) {
    const comp = settingsComponent({ guard });
    const first = comp.run({ count: 1, source: 'control-vector' });
    assert.equal(comp.c.original, '');
    const second = comp.run({ count: 2, source: 'settings' });   // before the first read is back
    first?.();
    second?.();
    if (guard) {
      assert.equal(comp.c.started, 2, 'it read again');
      assert.equal(comp.c.original, 'FILE', 'and the screen is filled');
    }
    else
      assert.equal(comp.c.original, '', 'without the guard the first read is cancelled by the early return and nothing fills the screen (the bug)');
  }
});

test('the control vector block drops the answer of a read that started before its own save answered, so it never shows the file as it was before the save', () => {
  const vector = src('NativeControlVector');
  assert.match(vector, /const mine = \+\+latest\.current;/);
  assert.match(vector, /if \(mine !== latest\.current\) return; setInfo\(value\);/);
  assert.match(vector, /latest\.current\+\+;\n\s+setInfo\(next\);/);
  // the same rule as a plain sequence, run: a read started before the save's answer arrives is dropped, one started after it is kept
  const latest = { current: 0 };
  const start = () => { const mine = ++latest.current; return () => mine === latest.current; };
  const early = start();
  latest.current++;   // the save answered
  assert.equal(early(), false);
  assert.equal(start()(), true);
});

test('the expert settings\' own save with no read in the air still does not read again', () => {
  const comp = settingsComponent({ guard: true });
  comp.run({ count: 1, source: 'control-vector' })();
  assert.equal(comp.c.original, 'FILE');
  assert.equal(comp.run({ count: 2, source: 'settings' }), undefined);
  assert.equal(comp.c.started, 1);
  assert.equal(comp.c.original, 'FILE');
});
