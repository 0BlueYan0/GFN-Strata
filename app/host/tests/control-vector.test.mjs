/**
 * The control vector setting (server/control-vector.mjs, this fork's addition): what a run config says, what a save writes, what a turn-off leaves behind,
 * every check on what the screen sends, and the sentences it shows in each language. Nothing here starts an engine.
 */
import './helpers/isolate-profile.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { read, write, validate, flagsFor, vectorFiles, checkVectorFiles, dataDirectory, presetPaths, presetsAvailable, createControlVector, FLAGS, MESSAGES, PRESETS, SUPPORTED_FAMILIES } from '../server/control-vector.mjs';
import { capture, groups, flagOf, USER_KEY, WRITTEN_KEY } from '../server/native-user-args.mjs';

const BASE = ['--pack', '/p', '--expert-cache', 'auto', '--max-context', '40000'];
const PATHS = { builtin: 'D:/Strata/control/data/experimental-speed-projection/Qwen3.8-Flash-Next-experimental-speed-projection.gguf', huihui: 'D:/Strata/control/data/control-vector-huihui/Huihui-Qwen3.8-Flash-Next-refusal-direction-r.gguf' };
const FILES = new Set([PATHS.builtin, PATHS.huihui, 'C:\\vectors\\mine.gguf', 'I:\\0BlueYan0\\cvec-test\\test.gguf', '/home/me/mine.gguf']);
const stat = path => { if (!FILES.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return { isFile: () => true }; };
const opts = { paths: PATHS, stat };
const on = (extra = {}) => ({ enabled: true, source: 'builtin', scale: 1, first: 4, last: 44, mode: 'project', dir: 'per-layer', single: null, ...extra });
const cvFlags = args => groups(args).filter(g => FLAGS.includes(flagOf(g)));
const setup = (extra = {}) => ({ model: 'q2_0', args: [...BASE], args_written: [...BASE], ...extra });

test('read: nothing in the config means off, with the screen\'s defaults', () => {
  const s = read(setup(), PATHS);
  assert.deepEqual([s.enabled, s.source, s.scale, s.first, s.last, s.mode, s.dir, s.multiple], [false, 'builtin', 1, 4, 44, 'project', 'per-layer', false]);
});

test('read: the four options give the state, a ready-made file is named, a path with a drive colon keeps it', () => {
  const config = setup({ args: [...BASE, '--control-vector-scaled', `${PATHS.huihui}:1.5`, '--control-vector-layer-range', '1', '47', '--cvec-mode', 'project', '--cvec-dir', 'single:20'] });
  const s = read(config, PATHS);
  assert.deepEqual([s.enabled, s.source, s.path, s.scale, s.first, s.last, s.mode, s.dir, s.single], [true, 'huihui', PATHS.huihui, 1.5, 1, 47, 'project', 'single', 20]);
  const mine = read(setup({ args: [...BASE, '--control-vector-scaled', 'I:\\0BlueYan0\\cvec-test\\test.gguf:1.0'] }), PATHS);
  assert.deepEqual([mine.source, mine.path, mine.scale], ['custom', 'I:\\0BlueYan0\\cvec-test\\test.gguf', 1]);
});

test('read: the engine starts in add mode when --cvec-mode is absent, the layer range is then 1 to the last layer; --control-vector is strength 1.0', () => {
  const s = read(setup({ args: [...BASE, '--control-vector', 'C:\\vectors\\mine.gguf'] }), PATHS);
  assert.deepEqual([s.enabled, s.path, s.scale, s.mode, s.first, s.last], [true, 'C:\\vectors\\mine.gguf', 1, 'add', 1, 47]);
});

test('read: two files, or --control-vector next to --control-vector-scaled, is "multiple"', () => {
  assert.equal(read(setup({ args: [...BASE, '--control-vector-scaled', 'C:\\a.gguf:1,C:\\b.gguf:0.5'] }), PATHS).multiple, true);
  assert.equal(read(setup({ args: [...BASE, '--control-vector', 'C:\\a.gguf', '--control-vector-scaled', 'C:\\b.gguf:1'] }), PATHS).multiple, true);
  assert.equal(read(setup({ args: [...BASE, '--control-vector-scaled', 'C:\\b.gguf:1'] }), PATHS).multiple, false);
});

test('read: options a person typed into "args" since the last write count, like any other hand-written option', () => {
  const typed = setup({ args: [...BASE, '--control-vector-scaled', 'C:\\vectors\\mine.gguf:2'] });
  assert.equal(read(typed, PATHS).scale, 2);
});

test('write on: the four options are in "args" and "user_args", the layer range is two separate values, the other options stay', () => {
  const config = setup({ [USER_KEY]: ['--vram-reserve-mib', '1024'], args: [...BASE, '--vram-reserve-mib', '1024'], args_written: [...BASE] });
  const next = write(config, validate(on(), opts));
  const mine = next[USER_KEY];
  assert.deepEqual(mine, ['--vram-reserve-mib', '1024', '--control-vector-scaled', `${PATHS.builtin}:1`, '--control-vector-layer-range', '4', '44', '--cvec-mode', 'project', '--cvec-dir', 'per-layer']);
  for (const flag of ['--control-vector-scaled', '--control-vector-layer-range', '--cvec-mode', '--cvec-dir']) assert.equal(next.args.filter(a => a === flag).length, 1, flag);
  assert.deepEqual(next.args.slice(next.args.indexOf('--control-vector-layer-range'), next.args.indexOf('--control-vector-layer-range') + 3), ['--control-vector-layer-range', '4', '44']);
  assert.ok(next.args.includes('--vram-reserve-mib') && next.args.includes('--max-context'));
  assert.deepEqual(next[WRITTEN_KEY], next.args, 'args_written is refreshed');
  assert.deepEqual(read(next, PATHS), { enabled: true, source: 'builtin', path: PATHS.builtin, scale: 1, first: 4, last: 44, mode: 'project', dir: 'per-layer', single: null, multiple: false });
});

test('write on: single:L, a strength with decimals and a Windows path round-trip through read', () => {
  const state = validate(on({ source: 'custom', path: 'I:\\0BlueYan0\\cvec-test\\test.gguf', scale: 0.75, dir: 'single', single: 20 }), opts);
  const next = write(setup(), state);
  assert.ok(next.args.includes('I:\\0BlueYan0\\cvec-test\\test.gguf:0.75'));
  assert.ok(next.args.includes('single:20'));
  const s = read(next, PATHS);
  assert.deepEqual([s.source, s.path, s.scale, s.dir, s.single], ['custom', 'I:\\0BlueYan0\\cvec-test\\test.gguf', 0.75, 'single', 20]);
});

test('write on: a hand-written --control-vector is removed, or two vectors would load', () => {
  const config = setup({ args: [...BASE, '--control-vector', 'C:\\vectors\\mine.gguf'] });
  const next = write(config, validate(on(), opts));
  assert.equal(next.args.includes('--control-vector'), false);
  assert.equal((next[USER_KEY] ?? []).includes('--control-vector'), false);
  assert.equal(vectorFiles(next).length, 1);
});

test('write off: the options leave "args", "user_args" and "args_written", and capture() does not read them back', () => {
  const enabled = write(setup({ [USER_KEY]: ['--vram-reserve-mib', '1024'], args: [...BASE, '--vram-reserve-mib', '1024'] }), validate(on(), opts));
  const off = write(enabled, { enabled: false });
  assert.equal(cvFlags(off.args).length, 0);
  assert.equal(cvFlags(off[USER_KEY] ?? []).length, 0);
  assert.equal(cvFlags(off[WRITTEN_KEY]).length, 0);
  assert.equal(cvFlags(capture(off)).length, 0, 'not taken back as hand-written');
  assert.deepEqual(off[USER_KEY], ['--vram-reserve-mib', '1024']);
  assert.equal(read(off, PATHS).enabled, false);
  // a second save of anything keeps it off
  assert.equal(cvFlags(capture(write(off, { enabled: false }))).length, 0);
});

test('write off: user_args disappears when nothing else is left in it, and a config with no args_written gets none', () => {
  const off = write(write({ model: 'x', args: [...BASE] }, validate(on(), opts)), { enabled: false });
  assert.equal(USER_KEY in off, false);
  assert.equal(WRITTEN_KEY in off, false);
  assert.deepEqual(off.args, BASE);
});

test('write off: options typed by hand into "args" go too, the person\'s other hand edits stay', () => {
  const config = setup({ args: [...BASE, '--control-vector-scaled', 'C:\\vectors\\mine.gguf:2', '--cvec-mode', 'add', '--spec', '3'] });
  const off = write(config, { enabled: false });
  assert.equal(cvFlags(off.args).length, 0);
  assert.ok(off.args.includes('--spec'));
  assert.deepEqual(off[USER_KEY], ['--spec', '3']);
});

test('flagsFor writes the four options in the order the engine documents them', () => {
  assert.deepEqual(flagsFor(on({ path: 'C:\\x.gguf', mode: 'add', scale: -2 })), ['--control-vector-scaled', 'C:\\x.gguf:-2', '--control-vector-layer-range', '4', '44', '--cvec-mode', 'add', '--cvec-dir', 'per-layer']);
  assert.deepEqual(flagsFor({ enabled: false }), []);
});

const bad = (input, key) => assert.throws(() => validate(input, opts), error => { assert.equal(error.message, MESSAGES[key]); return true; });

test('validate: off needs nothing else; the ready-made vectors take their installed path', () => {
  assert.deepEqual(validate({ enabled: false, scale: 'junk' }, opts), { enabled: false });
  assert.deepEqual(validate(undefined, opts), { enabled: false });
  assert.equal(validate(on({ source: 'huihui' }), opts).path, PATHS.huihui);
});

test('validate: every mistake in the screen\'s input is named in plain words', () => {
  bad(on({ source: 'other' }), 'source');
  bad(on({ source: 'custom', path: '' }), 'pathNone');
  bad(on({ source: 'custom', path: '   ' }), 'pathNone');
  bad(on({ source: 'custom', path: 'vectors/mine.gguf' }), 'pathAbsolute');
  bad(on({ source: 'custom', path: 'C:\\a,b.gguf' }), 'pathChars');
  bad(on({ source: 'custom', path: 'C:\\a\nb.gguf' }), 'pathChars');
  bad(on({ source: 'custom', path: 'C:\\vectors\\mine.bin' }), 'pathExt');
  bad(on({ source: 'custom', path: 'C:\\vectors\\gone.gguf' }), 'pathMissing');
  bad(on({ mode: 'blend' }), 'mode');
  bad(on({ scale: 0 }), 'scale');
  bad(on({ scale: Number.NaN }), 'scale');
  bad(on({ scale: Number.POSITIVE_INFINITY }), 'scale');
  bad(on({ scale: '1' }), 'scale');
  bad(on({ scale: 10.5 }), 'scale');
  bad(on({ scale: -0.5 }), 'scaleProject');
  bad(on({ first: 0 }), 'first');
  bad(on({ first: 2.5 }), 'first');
  bad(on({ first: Number.NaN }), 'first');
  bad(on({ first: 10, last: 9 }), 'last');
  bad(on({ last: 48 }), 'presetLayers');
  bad(on({ dir: 'sideways' }), 'dir');
  bad(on({ dir: 'single', single: null }), 'single');
  bad(on({ dir: 'single', single: 0 }), 'single');
  bad(on({ dir: 'single', single: 48 }), 'singleLayers');
  bad(on({ dir: 'single', single: 20, mode: 'add' }), 'singleMode');
});

test('validate: a missing ready-made file is reported; a file of your own may use layers past 47 and a negative strength in add mode', () => {
  assert.throws(() => validate(on(), { paths: { ...PATHS, builtin: 'D:/gone.gguf' }, stat }), { message: MESSAGES.presetMissing });
  assert.throws(() => validate(on(), { paths: {}, stat }), { message: MESSAGES.presetMissing });
  const mine = validate(on({ source: 'custom', path: '/home/me/mine.gguf', last: 60, mode: 'add', scale: -1.5 }), opts);
  assert.deepEqual([mine.last, mine.scale, mine.path], [60, -1.5, '/home/me/mine.gguf']);
});

test('presets: the ready-made files are listed for the families they were made for only', () => {
  assert.deepEqual(presetsAvailable(PATHS, { family: 'qwen', stat }), { builtin: true, huihui: true });
  assert.deepEqual(presetsAvailable(PATHS, { family: 'swift', stat }), { builtin: false, huihui: false });
  assert.deepEqual(presetsAvailable({ builtin: PATHS.builtin }, { family: 'unsloth', stat }), { builtin: true, huihui: false });
  assert.ok(SUPPORTED_FAMILIES.includes('swift') && SUPPORTED_FAMILIES.includes('nvfp4') && !SUPPORTED_FAMILIES.includes('qwen36'));
  assert.deepEqual(presetsAvailable(PATHS, { family: 'nvfp4', stat }), { builtin: true, huihui: true });
  assert.equal(presetPaths('D:/data').huihui.replace(/\\/g, '/'), `D:/data/${PRESETS.huihui.folder}/${PRESETS.huihui.file}`);
});

test('checkVectorFiles: a full path that is not a file stops the load with a sentence that names it, whoever wrote it; a relative path is left to the engine', () => {
  const gone = file => ({ message: MESSAGES.fileGone.replace('{0}', file) });
  const named = (file, flag = '--control-vector-scaled', value = `${file}:1`) => ({ args: [flag, value], args_written: [flag, value] });
  assert.doesNotThrow(() => checkVectorFiles(named('C:\\vectors\\mine.gguf'), stat));
  assert.throws(() => checkVectorFiles(named('C:\\vectors\\gone.gguf'), stat), gone('C:\\vectors\\gone.gguf'));
  assert.throws(() => checkVectorFiles(named('', '--control-vector', 'C:\\vectors\\gone.gguf'), stat), gone('C:\\vectors\\gone.gguf'));
  assert.doesNotThrow(() => checkVectorFiles(named('vectors/gone.gguf'), stat));
  assert.doesNotThrow(() => checkVectorFiles({ args: BASE, args_written: BASE }, stat));
  assert.throws(() => checkVectorFiles({ args: ['--control-vector-scaled', 'C:\\vectors\\gone.gguf:1'], args_written: BASE }, stat), gone('C:\\vectors\\gone.gguf'), 'typed by hand since the last write');
  assert.throws(() => checkVectorFiles({ args: ['--control-vector-scaled', 'C:\\vectors\\gone.gguf:1'] }, stat), gone('C:\\vectors\\gone.gguf'), 'no args_written');
  assert.throws(() => checkVectorFiles({ [USER_KEY]: ['--control-vector-scaled', 'I:\\0BlueYan0\\gone.gguf:1.0'], args: BASE }, stat), gone('I:\\0BlueYan0\\gone.gguf'), 'user_args');
  assert.throws(() => checkVectorFiles({ args: ['--control-vector-scaled', `${PATHS.builtin}:1,C:\\vectors\\gone.gguf:1`] }, stat), gone('C:\\vectors\\gone.gguf'), 'the second of two');
});

test('dataDirectory: the installed app reads the data folder named by control.control.dir of what createControl() returns; a source run reads the checkout folder', () => {
  const created = { control: { dir: 'D:/Strata/control', python: 'p' }, version: '0.1.62.3' };   // the shape control-runtime.mjs createControl() returns
  assert.equal(dataDirectory({ packaged: true, control: created, repo: () => 'X' }).replace(/\\/g, '/'), 'D:/Strata/control/data');
  assert.equal(dataDirectory({ packaged: false, control: null, repo: () => 'C:/src/terminal' }).replace(/\\/g, '/'), 'C:/src/terminal/data');
  const dir = mkdtempSync(join(tmpdir(), 'strata-cvec-data-'));
  try {
    for (const preset of Object.values(PRESETS)) { mkdirSync(join(dir, 'control', 'data', preset.folder), { recursive: true }); writeFileSync(join(dir, 'control', 'data', preset.folder, preset.file), 'v'); }
    const found = presetsAvailable(presetPaths(dataDirectory({ packaged: true, control: { control: { dir: join(dir, 'control') } }, repo: () => 'X' })), { family: 'qwen' });
    assert.deepEqual(found, { builtin: true, huihui: true });
    const wrong = presetsAvailable(presetPaths(dataDirectory({ packaged: true, control: { dir: join(dir, 'control') }, repo: () => 'X' })), { family: 'qwen' });
    assert.deepEqual(wrong, { builtin: false, huihui: false }, 'the object without .control finds nothing, which is the bug this guards');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const wiring = readFileSync(new URL('../server/native-control.mjs', import.meta.url), 'utf8');
  assert.ok(wiring.includes('dataDir:()=>dataDirectory({packaged,control,repo})'), 'native-control.mjs hands the whole createControl() object over');
});

function fixture(config, { family = 'qwen', platform = 'win32', busy = false, running = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'strata-cvec-test-'));
  const data = join(root, 'data');
  for (const preset of Object.values(PRESETS)) { mkdirSync(join(data, preset.folder), { recursive: true }); writeFileSync(join(data, preset.folder, preset.file), 'vector'); }
  const custom = join(root, 'mine.gguf');
  writeFileSync(custom, 'vector');
  const path = join(root, 'strata-q2_0.json');
  writeFileSync(path, JSON.stringify(config));
  const api = createControlVector({ record: () => ({ path, config: JSON.parse(readFileSync(path, 'utf8')) }), jobsRunning: () => running, modelBusy: () => busy, dataDir: () => data, family: () => family, platform: () => platform });
  return { api, path, custom, data, read: () => JSON.parse(readFileSync(path, 'utf8')), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const request = (f, extra = {}) => ({ enabled: true, source: 'huihui', scale: 1, first: 4, last: 44, mode: 'project', dir: 'per-layer', ...extra, ...(extra.source === 'custom' ? { path: f.custom } : {}) });

test('the model screen\'s calls: get reports support, presets and state; save writes the file with a backup, off cleans it', () => {
  const f = fixture(setup());
  try {
    const before = f.api.get('q2_0');
    assert.deepEqual([before.supported, before.presets, before.state.enabled], [true, { builtin: true, huihui: true }, false]);
    const saved = f.api.save('q2_0', request(f));
    assert.equal(saved.state.source, 'huihui');
    assert.equal(saved.state.enabled, true);
    assert.ok(existsSync(f.path + '.bak'));
    assert.deepEqual(JSON.parse(readFileSync(f.path + '.bak', 'utf8')).args, BASE);
    assert.ok(f.read().args.includes('--cvec-dir'));
    const off = f.api.save('q2_0', { enabled: false });
    assert.equal(off.state.enabled, false);
    const file = f.read();
    assert.equal(cvFlags(file.args).length + cvFlags(file[USER_KEY] ?? []).length + cvFlags(file[WRITTEN_KEY]).length, 0);
    assert.equal(f.api.get('q2_0').state.enabled, false, 'read again: still off');
  } finally { f.cleanup(); }
});

test('the model screen\'s calls: more than one vector in the file is left alone', () => {
  const f = fixture(setup({ args: [...BASE, '--control-vector-scaled', 'C:\\a.gguf:1,C:\\b.gguf:0.5'] }));
  try {
    const text = readFileSync(f.path, 'utf8');
    assert.equal(f.api.get('q2_0').state.multiple, true);
    assert.throws(() => f.api.save('q2_0', request(f)), { message: MESSAGES.multiple });
    assert.throws(() => f.api.save('q2_0', { enabled: false }), { message: MESSAGES.multiple });
    assert.equal(readFileSync(f.path, 'utf8'), text);
    assert.equal(existsSync(f.path + '.bak'), false);
  } finally { f.cleanup(); }
});

test('the model screen\'s calls: not shown on a Mac or for a model that takes none; refused while work or a request runs; a rejected save writes nothing', () => {
  const mac = fixture(setup(), { platform: 'darwin' }), other = fixture(setup(), { family: 'qwen36' }), swift = fixture(setup(), { family: 'swift' });
  const arch = fixture(setup({ arch: 'qwen35moe' })), busy = fixture(setup(), { busy: true }), running = fixture(setup(), { running: true });
  try {
    assert.equal(mac.api.get('q2_0').supported, false);
    assert.throws(() => mac.api.save('q2_0', request(mac)), { message: MESSAGES.unsupported });
    assert.equal(other.api.get('q2_0').supported, false);
    assert.throws(() => other.api.save('q2_0', request(other)), { message: MESSAGES.unsupported });
    assert.equal(arch.api.get('q2_0').supported, false);
    assert.equal(swift.api.get('q2_0').supported, true);
    assert.deepEqual(swift.api.get('q2_0').presets, { builtin: false, huihui: false });
    assert.throws(() => swift.api.save('q2_0', request(swift)), { message: MESSAGES.source });
    assert.equal(swift.api.save('q2_0', request(swift, { source: 'custom' })).state.source, 'custom');
    assert.throws(() => busy.api.save('q2_0', request(busy)), /requests/);
    assert.throws(() => running.api.save('q2_0', request(running)), /current operation/);
    const text = readFileSync(other.path, 'utf8');
    assert.throws(() => fixture(setup()).api.save('q2_0', request({}, { first: 0 })), { message: MESSAGES.first });
    assert.equal(readFileSync(other.path, 'utf8'), text);
  } finally { for (const f of [mac, other, swift, arch, busy, running]) f.cleanup(); }
});

const english = JSON.parse(readFileSync(new URL('../src/locales/gfn-en.json', import.meta.url), 'utf8'));
const LANGS = ['zh', 'ja', 'de', 'es', 'ru', 'pt', 'ko', 'fr', 'he'];

test('every sentence of the setting is in the gfn catalog, translated in the nine other languages', () => {
  const component = readFileSync(new URL('../src/components/NativeControlVector.tsx', import.meta.url), 'utf8');
  const shared = JSON.parse(readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8'));
  const ids = text => Object.entries(english).find(([, v]) => v === text)?.[0];
  for (const text of Object.values(MESSAGES)) assert.ok(ids(text), `server sentence has a key: ${text}`);
  for (const [, text] of component.matchAll(/tr\("((?:[^"\\]|\\.)*)"\)/g)) assert.ok(ids(text) || Object.values(shared).includes(text), `component sentence has a key: ${text}`);
  for (const text of [...component.matchAll(/label: "([^"]+)"/g)].map(m => m[1])) assert.ok(ids(text), `option label has a key: ${text}`);
  for (const lang of LANGS) {
    const translated = JSON.parse(readFileSync(new URL(`../src/locales/gfn-${lang}.json`, import.meta.url), 'utf8'));
    for (const [id, text] of Object.entries(english)) {
      assert.ok(translated[id], `${lang} ${id}`);
      if (/[A-Za-z]{4,} [a-z]{2,} [a-z]{2,}/.test(text)) assert.notEqual(translated[id], text, `${lang} ${id} is translated`);
    }
  }
});
