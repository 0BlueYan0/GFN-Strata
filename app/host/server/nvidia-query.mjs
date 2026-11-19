/**
 * Asking for NVIDIA card data when nvidia-smi cannot be started (GeForce NOW and other locked-down systems refuse to start
 * nvidia-smi.exe and powershell.exe, but the interpreter Control ships still starts and reads the driver's NVML in its own process).
 *
 * `nvidiaQuery` runs nvidia-smi exactly as before. Only when that prints nothing, and only for a `--query-gpu` call, it asks
 * `python -m strata_control.nvidia_cards` with the same arguments; that module prints the same CSV and nothing when NVML cannot read either.
 * Other calls (`dmon`) never start Python: they only exist for nvidia-smi.
 */
import { execFile, execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe } from './util.mjs';
import { findControl, controlEnvironment } from './control-runtime.mjs';
import { resolvePython } from './python-resolver.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PYTHON_TIMEOUT_MS = 5_000;

/** Is this a `--query-gpu` call (the only one the Python module answers)? */
export const isGpuQuery = args => Array.isArray(args) && args.some(arg => String(arg).startsWith('--query-gpu'));

/**
 * What to run: Control's interpreter in Control's folder in the installed app, the repository's Python in the repository
 * folder from a source checkout. The folder is the working directory so `strata_control` imports.
 */
export function pythonTarget({ control = findControl(), env = process.env, repo = REPO } = {}) {
  const python = resolvePython({ repo, control, env });
  return {
    command: python.command,
    args: [...python.args, '-m', 'strata_control.nvidia_cards'],
    cwd: control?.dir ?? repo,
    env: control ? controlEnvironment(control, { env }) : { ...env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  };
}

/** Run the module asynchronously; resolves its trimmed output, or '' when it cannot start, times out or prints nothing. */
function runPython(target, args, timeout) {
  return new Promise(done => {
    try {
      execFile(target.command, [...target.args, ...args], { cwd: target.cwd, env: target.env, timeout: Math.max(timeout, PYTHON_TIMEOUT_MS), windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' },
        (error, stdout) => done(error ? '' : String(stdout ?? '').trim()));
    } catch { done(''); }
  });
}

function runPythonSync(target, args, timeout) {
  try {
    return String(execFileSync(target.command, [...target.args, ...args], { cwd: target.cwd, env: target.env, encoding: 'utf8', timeout: Math.max(timeout, PYTHON_TIMEOUT_MS), windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })).trim();
  } catch { return ''; }
}

/** `run` and `python` (a pythonTarget-shaped object) are injectable for tests; `runPython` replaces the Python call itself. `pythonTimeout` (ms) is the Python call's own limit when it should differ from nvidia-smi's (never below 5 s). */
export async function nvidiaQuery(args, timeout = 4000, { run = probe, python = null, runPython: runner = runPython, platform = process.platform, pythonTimeout = null } = {}) {
  const smi = await run('nvidia-smi', args, timeout);
  if (smi || !isGpuQuery(args) || platform === 'darwin') return smi;   // a Mac has no NVML
  try { return await runner(python ?? pythonTarget(), args, pythonTimeout ?? timeout); } catch { return ''; }
}

/** The same rule for synchronous callers. `runSync` runs nvidia-smi and returns its output (throws when it cannot start). */
export function nvidiaQuerySync(args, timeout = 8000, { runSync = null, python = null, runPython: runner = runPythonSync, platform = process.platform } = {}) {
  let smi = '';
  try {
    smi = String(runSync ? runSync('nvidia-smi', args, timeout) : execFileSync('nvidia-smi', args, { encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })).trim();
  } catch { /* nvidia-smi cannot start */ }
  if (smi || !isGpuQuery(args) || platform === 'darwin') return smi;
  try { return runner(python ?? pythonTarget(), args, timeout); } catch { return ''; }
}
