/* The control vector setting of a model (this fork's addition, kept out of native-control.mjs so a merge with upstream stays small).
 * The state lives only in the model's run config, in the engine's own options (--control-vector-scaled, --control-vector-layer-range,
 * --cvec-mode, --cvec-dir), the same way --vram-reserve-mib does: the Terminal then applies it too and no new settings key exists.
 * Engine facts (engine/src/program/generate.cpp, load_control_vectors and the option parser):
 *  - project mode removes the unit direction scaled by |strength| (h -= s (h.v) v), so the strength's sign has no effect there;
 *    add mode adds strength * direction, and a negative strength reverses it. The engine accepts any finite strength but 0 is no change.
 *  - layers: first < 1 means 1; last < 1 or past the model means the last layer; "single:L" needs a direction at layer L and is used in project mode only.
 *  - the mode the engine starts with when no option is given is "add".
 *  - a direction that is not 2,560 f32 values stops the load with an error, it is never skipped. */
import { statSync, copyFileSync, chmodSync, writeFileSync, renameSync } from 'node:fs';
import { win32, posix, join } from 'node:path';
import { USER_KEY, WRITTEN_KEY, groups, flagOf, flat, merge, capture, stamped } from './native-user-args.mjs';

export const FLAGS = ['--control-vector', '--control-vector-scaled', '--control-vector-layer-range', '--cvec-mode', '--cvec-dir'];
export const PRESETS = {
  builtin: { folder: 'experimental-speed-projection', file: 'Qwen3.8-Flash-Next-experimental-speed-projection.gguf', layers: 47 },
  huihui: { folder: 'control-vector-huihui', file: 'Huihui-Qwen3.8-Flash-Next-refusal-direction-r.gguf', layers: 47 },
};
export const DEFAULTS = { source: 'builtin', scale: 1, first: 4, last: 44, mode: 'project', dir: 'per-layer', single: null };
export const SCALE_LIMIT = 10;

/* The families that run Qwen3.8-Flash-Next's engine path (native-control.mjs savedKv) take a control vector; Qwen3.6-35B-A3B ("qwen36") does not.
 * The two ready-made vectors were made for the original model: Swift 1.5, a fine-tune, takes only a file of the person's own.
 * "nvfp4" is the same model with NVFP4 experts (setup.py:753, title "Qwen3.8-Flash-Next (NVFP4)"); the control vector is applied to the residual stream in the same
 * engine program whatever format the experts have (engine/src/core/layer.cpp, engine/include/strata/kernels/cvec.hpp), so it is listed. Not run on a real NVFP4 load. */
export const SUPPORTED_FAMILIES = ['qwen', 'swift', 'coder', 'unsloth', 'gyro', 'nvfp4'];
export const PRESET_FAMILIES = ['qwen', 'coder', 'unsloth', 'gyro', 'nvfp4'];

export const MESSAGES = {
  unsupported: 'This model does not take a control vector.',
  multiple: 'The settings file names more than one control vector. Change it in the settings file.',
  source: 'Vector: choose the built-in vector, the Huihui vector or your own file.',
  presetMissing: 'The file of this control vector is missing from this installation.',
  pathNone: 'Control vector file: enter the full path of a .gguf file.',
  pathAbsolute: 'Control vector file: enter the full path, starting at the drive or the root folder.',
  pathChars: 'Control vector file: the path cannot contain a comma or a line break.',
  pathExt: 'Control vector file: the file name must end in .gguf.',
  pathMissing: 'Control vector file: there is no file at that path.',
  scale: 'Strength: enter a number other than 0, from -10 to 10.',
  scaleProject: 'Strength: in project mode enter a number above 0, up to 10.',
  first: 'First layer: enter a whole number of 1 or more.',
  last: 'Last layer: enter a whole number that is not below the first layer.',
  presetLayers: 'Last layer: this vector has layers 1 to 47.',
  mode: 'Mode: choose project or add.',
  dir: 'Direction: choose per-layer or single.',
  single: 'Layer number: enter a whole number of 1 or more.',
  singleLayers: 'Layer number: this vector has layers 1 to 47.',
  singleMode: 'Direction: single works in project mode only.',
  fileGone: 'The control vector file {0} does not exist. Choose another file in the model settings, or turn the control vector off.',
};

const fail = key => { throw new Error(MESSAGES[key]); };
const isFiniteNumber = v => typeof v === 'number' && Number.isFinite(v);
const whole = v => typeof v === 'number' && Number.isInteger(v);
const sameFile = (a, b) => {
  const x = String(a).replace(/\\/g, '/'), y = String(b).replace(/\\/g, '/');
  return x === y || (/^[A-Za-z]:\//.test(x) && x.toLowerCase() === y.toLowerCase());
};
const absolute = p => win32.isAbsolute(p) || posix.isAbsolute(p);

/** Where the two ready-made vectors are: <data folder>/<folder>/<file>. `dataDir` is the installed Control's data folder or the source checkout's. */
export function presetPaths(dataDir) {
  return Object.fromEntries(Object.entries(PRESETS).map(([id, p]) => [id, join(dataDir, p.folder, p.file)]));
}

function isFile(path, stat = statSync) { try { return stat(path).isFile(); } catch { return false; } }

/** The vectors the person can pick: which ready-made files exist for this model. */
export function presetsAvailable(paths, { family, stat = statSync } = {}) {
  const allowed = PRESET_FAMILIES.includes(family);
  return Object.fromEntries(Object.keys(PRESETS).map(id => [id, allowed && !!paths?.[id] && isFile(paths[id], stat)]));
}

const lastValue = (gs, flag) => { const found = gs.filter(g => flagOf(g) === flag); return found.length ? found[found.length - 1] : null; };

/** The control vector state of a run config (what the engine would get): the options of "args" with the person's own ("user_args" and hand edits) over them. */
export function read(config, paths = {}) {
  const args = merge(config?.args ?? [], capture(config ?? {}));
  const gs = groups(args);
  const scaled = gs.filter(g => flagOf(g) === '--control-vector-scaled'), plain = gs.filter(g => flagOf(g) === '--control-vector');
  const state = { enabled: false, source: DEFAULTS.source, path: '', scale: DEFAULTS.scale, first: DEFAULTS.first, last: DEFAULTS.last, mode: DEFAULTS.mode, dir: DEFAULTS.dir, single: null, multiple: false };
  if (!scaled.length && !plain.length) return state;
  state.enabled = true;
  const items = [];
  for (const g of scaled) for (const item of String(g[1] ?? '').split(',')) if (item) items.push(item);
  for (const g of plain) if (g[1]) items.push(`${g[1]}:1`);
  state.multiple = items.length > 1;
  if (items.length) {
    const item = items[items.length - 1], colon = item.lastIndexOf(':');
    state.path = colon > 0 ? item.slice(0, colon) : item;
    const strength = colon > 0 ? Number(item.slice(colon + 1)) : NaN;
    if (Number.isFinite(strength)) state.scale = strength;
  }
  state.source = Object.keys(PRESETS).find(id => paths[id] && sameFile(paths[id], state.path)) ?? 'custom';
  const range = lastValue(gs, '--control-vector-layer-range');
  state.first = range && Number.isInteger(Number(range[1])) && Number(range[1]) > 0 ? Number(range[1]) : 1;
  state.last = range && Number.isInteger(Number(range[2])) && Number(range[2]) > 0 ? Number(range[2]) : 47;
  const mode = lastValue(gs, '--cvec-mode')?.[1];
  state.mode = mode === 'project' ? 'project' : 'add';
  const dir = lastValue(gs, '--cvec-dir')?.[1] ?? '';
  const single = /^single:(\d+)$/.exec(dir);
  if (single) { state.dir = 'single'; state.single = Number(single[1]); }
  return state;
}

/** Check a state the screen sent and return it with the file path filled in (the ready-made vectors get their installed path). Throws a plain sentence. */
export function validate(input, { paths = {}, stat = statSync } = {}) {
  const s = input && typeof input === 'object' ? input : {};
  if (s.enabled !== true) return { enabled: false };
  const out = { enabled: true, source: s.source, scale: s.scale, first: s.first, last: s.last, mode: s.mode, dir: s.dir, single: s.single ?? null };
  const preset = PRESETS[out.source];
  if (!preset && out.source !== 'custom') fail('source');
  if (preset) {
    out.path = paths[out.source];
    if (!out.path || !isFile(out.path, stat)) fail('presetMissing');
  } else {
    const path = typeof s.path === 'string' ? s.path.trim() : '';
    if (!path) fail('pathNone');
    if (/[,\r\n\0]/.test(path)) fail('pathChars');
    if (!absolute(path)) fail('pathAbsolute');
    if (!/\.gguf$/i.test(path)) fail('pathExt');
    if (!isFile(path, stat)) fail('pathMissing');
    out.path = path;
  }
  if (out.mode !== 'project' && out.mode !== 'add') fail('mode');
  if (!isFiniteNumber(out.scale) || out.scale === 0 || Math.abs(out.scale) > SCALE_LIMIT) fail('scale');
  if (out.mode === 'project' && out.scale < 0) fail('scaleProject');
  if (!whole(out.first) || out.first < 1) fail('first');
  if (!whole(out.last) || out.last < out.first) fail('last');
  if (preset && out.last > preset.layers) fail('presetLayers');
  if (out.dir !== 'per-layer' && out.dir !== 'single') fail('dir');
  if (out.dir === 'single') {
    if (out.mode !== 'project') fail('singleMode');
    if (!whole(out.single) || out.single < 1) fail('single');
    if (preset && out.single > preset.layers) fail('singleLayers');
  } else out.single = null;
  return out;
}

const withoutFlags = args => flat(groups(args).filter(g => !FLAGS.includes(flagOf(g))));

/** The control vector options for a validated state, as the engine's arguments. */
export function flagsFor(state) {
  if (!state.enabled) return [];
  return ['--control-vector-scaled', `${state.path}:${state.scale}`, '--control-vector-layer-range', String(state.first), String(state.last),
    '--cvec-mode', state.mode, '--cvec-dir', state.dir === 'single' ? `single:${state.single}` : 'per-layer'];
}

/** A new run config with the control vector set (validated state) or removed. The five options leave "args" and "user_args" together, a hand-written
 *  --control-vector too (two vectors would load), and "args_written" is refreshed: left behind, the old options would look hand-written at the next
 *  save and switch the vector on again. The person's other options stay. */
export function write(config, state) {
  const mine = [...withoutFlags(capture(config)), ...flagsFor(state)];
  const next = stamped({ ...config, args: withoutFlags(config.args ?? []) }, mine);
  if (!Array.isArray(config.args) && !next.args.length) delete next.args;
  if (!mine.length) delete next[USER_KEY];
  if (WRITTEN_KEY in config) next[WRITTEN_KEY] = [...(next.args ?? [])];
  return next;
}

/** The control vector file a config names, for the check before a load. Returns '' when none. */
export function vectorFiles(config) {
  const gs = groups(merge(config?.args ?? [], capture(config ?? {})));
  const files = [];
  for (const g of gs) {
    if (flagOf(g) === '--control-vector' && g[1]) files.push(g[1]);
    if (flagOf(g) === '--control-vector-scaled') for (const item of String(g[1] ?? '').split(',')) { const colon = item.lastIndexOf(':'); if (colon > 0) files.push(item.slice(0, colon)); }
  }
  return files;
}

/** Before a load: every control vector file the run config names must exist, whether the app wrote it or the person typed it into the settings file, or the
 *  engine would stop with a message about a GGUF header. The sentence names the file. Only full paths can be checked (a relative one is the engine's to resolve). */
export function checkVectorFiles(config, stat = statSync) {
  for (const file of vectorFiles(config)) if (absolute(file) && !isFile(file, stat)) throw new Error(MESSAGES.fileGone.replace('{0}', file));
}

/** The folder the ready-made vectors are in: Control's data folder in the installed app, the checkout's in a source run. `control` is what createControl()
 *  returns ({control: {dir}, version, ...}), so the folder is control.control.dir. */
export function dataDirectory({ packaged, control, repo }) {
  return packaged ? join(control?.control?.dir ?? '', 'data') : join(repo(), 'data');
}

/** The two calls of the model screen. `record(model)` is native-control's ({path, config}); the guards are the ones save() has: no operation running, no request
 *  running on this model. A config that names more than one vector is the person's own work and is never overwritten. */
export function createControlVector({ record, jobsRunning, modelBusy, dataDir, family, platform = () => process.platform, stat = statSync }) {
  const supportedFor = (model, config) => platform() !== 'darwin' && SUPPORTED_FAMILIES.includes(family(model)) && (!config.arch || config.arch === 'qwen4exp');
  function get(model) {
    const { config } = record(model), paths = presetPaths(dataDir());
    const supported = supportedFor(model, config);
    return { model, supported, presets: supported ? presetsAvailable(paths, { family: family(model), stat }) : { builtin: false, huihui: false },
      defaults: DEFAULTS, limits: { scale: SCALE_LIMIT, layers: PRESETS.builtin.layers }, state: read(config, paths) };
  }
  function save(model, body) {
    if (jobsRunning()) throw new Error('Finish the current operation before saving native settings.');
    const { path, config } = record(model);
    if (modelBusy(model)) throw new Error('Finish this model’s requests before saving its settings.');
    if (!supportedFor(model, config)) throw new Error(MESSAGES.unsupported);
    const paths = presetPaths(dataDir());
    if (read(config, paths).multiple) throw new Error(MESSAGES.multiple);
    const state = validate(body, { paths, stat });
    if (state.enabled && PRESETS[state.source] && !presetsAvailable(paths, { family: family(model), stat })[state.source]) throw new Error(MESSAGES.source);
    const next = write(config, state);
    copyFileSync(path, path + '.bak');
    chmodSync(path + '.bak', 0o600);
    const temp = path + '.ui-tmp';
    writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    renameSync(temp, path);
    return get(model);
  }
  return { get, save };
}
