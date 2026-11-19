import test from 'node:test';
import assert from 'node:assert/strict';
import { nvidiaQuery, nvidiaQuerySync, isGpuQuery } from '../server/nvidia-query.mjs';
import { readGpuTelemetry, parseNvidiaDevices, parseNvidiaReadings } from '../server/device-probes.mjs';

const DEVICE_ARGS = ['--query-gpu=index,uuid,pci.bus_id,name,memory.total,driver_version', '--format=csv,noheader,nounits'];
const DEVICES = '0, GPU-11111111-2222-3333-4444-555555555555, 00000000:01:00.0, NVIDIA GeForce RTX 5080, 49152, 621.14';
const READING_ARGS = ['--query-gpu=uuid,temperature.gpu,utilization.gpu,memory.used,power.draw,power.limit,pcie.link.gen.current,pcie.link.gen.max,pcie.link.width.current,fan.speed,clocks.current.graphics', '--format=csv,noheader,nounits'];
const READING = 'GPU-11111111-2222-3333-4444-555555555555, 41, 7, 47651, 35.20, 360.00, 5, 5, 16, 30, 2100';
const TARGET = { command: 'py', args: ['-m', 'strata_control.nvidia_cards'], cwd: '.', env: {} };

test('nvidia-smi answers: Python is not started', async () => {
  const python = [];
  const out = await nvidiaQuery(DEVICE_ARGS, 4000, { run: async () => DEVICES, python: TARGET, platform: 'win32', runPython: async (...a) => { python.push(a); return 'x'; } });
  assert.equal(out, DEVICES);
  assert.equal(python.length, 0);
});

test('nvidia-smi prints nothing: Python gets the same arguments and its output is parsed like nvidia-smi output', async () => {
  const seen = [];
  const out = await nvidiaQuery(DEVICE_ARGS, 4000, { run: async () => '', python: TARGET, platform: 'win32', runPython: async (target, args) => { seen.push([target, args]); return DEVICES; } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], TARGET);
  assert.deepEqual(seen[0][1], DEVICE_ARGS);
  const [gpu] = parseNvidiaDevices(out);
  assert.equal(gpu.name, 'NVIDIA GeForce RTX 5080');
  assert.equal(gpu.vramGb, 48);
  assert.equal(gpu.driver, '621.14');
  const [reading] = parseNvidiaReadings(await nvidiaQuery(READING_ARGS, 2000, { run: async () => '', python: TARGET, platform: 'win32', runPython: async () => READING }));
  assert.equal(reading.id, gpu.id);
  assert.equal(reading.temperatureC, 41);
  assert.equal(reading.memoryUsedGb, 46.53);
});

test('dmon and other calls without --query-gpu never start Python', async () => {
  let started = 0;
  const out = await nvidiaQuery(['dmon', '-s', 't', '-c', '1'], 1500, { run: async () => '', python: TARGET, platform: 'win32', runPython: async () => { started++; return 'x'; } });
  assert.equal(out, '');
  assert.equal(started, 0);
  assert.equal(isGpuQuery(['dmon']), false);
  assert.equal(isGpuQuery(DEVICE_ARGS), true);
});

test('Python that fails to start or throws gives an empty answer', async () => {
  assert.equal(await nvidiaQuery(DEVICE_ARGS, 4000, { run: async () => '', python: TARGET, platform: 'win32', runPython: async () => { throw new Error('boom'); } }), '');
  assert.equal(await nvidiaQuery(DEVICE_ARGS, 4000, { run: async () => '', python: TARGET, platform: 'win32', runPython: async () => '' }), '');
});

test('the synchronous form follows the same rule', () => {
  const calls = [];
  const python = (target, args) => { calls.push(args); return '621.14'; };
  assert.equal(nvidiaQuerySync(['--query-gpu=driver_version', '--format=csv,noheader'], 8000, { runSync: () => { throw new Error('Access is denied'); }, python: TARGET, platform: 'win32', runPython: python }), '621.14');
  assert.deepEqual(calls, [['--query-gpu=driver_version', '--format=csv,noheader']]);
  assert.equal(nvidiaQuerySync(['--query-gpu=driver_version', '--format=csv,noheader'], 8000, { runSync: () => '610.62\n', python: TARGET, platform: 'win32', runPython: python }), '610.62');
  assert.equal(calls.length, 1);
  assert.equal(nvidiaQuerySync(['dmon'], 8000, { runSync: () => '', python: TARGET, platform: 'win32', runPython: python }), '');
  assert.equal(calls.length, 1);
});

test('readGpuTelemetry with an injected run is not affected by the Python fallback', async () => {
  const calls = [];
  const run = async (command, args) => { calls.push([command, args[0]]); return args[0].startsWith('--query-gpu') ? READING : ''; };
  const [reading] = await readGpuTelemetry([{ id: 'GPU-11111111-2222-3333-4444-555555555555', vendor: 'nvidia', index: 0, sensorIndex: 0 }], { run });
  assert.equal(reading.temperatureC, 41);
  assert.ok(calls.every(([command]) => command === 'nvidia-smi'));
});

test('on a Mac Python is never started, asynchronously or synchronously', async () => {
  let started = 0;
  const runner = async () => { started++; return 'x'; };
  assert.equal(await nvidiaQuery(DEVICE_ARGS, 4000, { run: async () => '', python: TARGET, runPython: runner, platform: 'darwin' }), '');
  assert.equal(nvidiaQuerySync(DEVICE_ARGS, 4000, { runSync: () => '', python: TARGET, runPython: runner, platform: 'darwin' }), '');
  assert.equal(started, 0);
  assert.equal(await nvidiaQuery(DEVICE_ARGS, 4000, { run: async () => '', python: TARGET, runPython: runner, platform: 'win32' }), 'x');
});

// detectGpus is not exported and readGpuTelemetry's default runner is private, and starting a real Python here would make the test depend on the
// machine, so the wiring is pinned in the source: the callers must go through nvidiaQuery, not straight to probe('nvidia-smi').
test('hardware detection, the default telemetry runner and the driver check go through nvidia-query', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = name => readFile(new URL(`../server/${name}`, import.meta.url), 'utf8');
  const [hardware, probes, engine] = await Promise.all([read('hardware.mjs'), read('device-probes.mjs'), read('bundled-engine.mjs')]);
  assert.match(hardware, /await nvidiaQuery\(\['--query-gpu=index,uuid,pci\.bus_id,name,memory\.total,driver_version'/);
  assert.doesNotMatch(hardware, /probe\('nvidia-smi'/);
  assert.match(probes, /nvidiaRun = \(command, args, timeout\) => \(command === 'nvidia-smi' \? nvidiaQuery\(args, timeout\)/);
  assert.match(probes, /run = nvidiaRun/);
  assert.match(engine, /nvidiaQuerySync\(\['--query-gpu=driver_version'/);
  assert.doesNotMatch(engine, /execFileSync\('nvidia-smi'/);
});

test('pythonTimeout is the limit handed to the Python call, nvidia-smi keeps its own; without it the call gets the nvidia-smi limit', async () => {
  const limits = { smi: null, python: [] };
  const run = async (command, args, timeout) => { limits.smi = timeout; return ''; };
  const runner = async (target, args, timeout) => { limits.python.push(timeout); return DEVICES; };
  await nvidiaQuery(DEVICE_ARGS, 4000, { run, python: TARGET, runPython: runner, platform: 'win32', pythonTimeout: 10_000 });
  await nvidiaQuery(DEVICE_ARGS, 2000, { run, python: TARGET, runPython: runner, platform: 'win32' });
  assert.equal(limits.smi, 2000);
  assert.deepEqual(limits.python, [10_000, 2000]);
});

test('hardware detection gives Python 10 seconds', async () => {
  const { readFile } = await import('node:fs/promises');
  const hardware = await readFile(new URL('../server/hardware.mjs', import.meta.url), 'utf8');
  assert.match(hardware, /await nvidiaQuery\(\[[^\]]*\],4000,\{pythonTimeout:10_000\}\)/);
});
