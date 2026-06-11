// Power plan + low-power "Server Mode" management.
//
// Design rules (agreed in planning):
//  - NEVER edit the user's existing power plans. We create a dedicated
//    "Hermes Server Mode" plan (duplicated from Balanced) and only toggle that.
//  - Plan create / switch / CPU-cap operations run WITHOUT elevation
//    (a standard user can manage their own schemes).
//  - Only `powercfg /requests` needs admin; that path lazily elevates a helper.
//  - System-suspend prevention uses Electron's powerSaveBlocker, not shell.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SERVER_PLAN_NAME = 'Hermes Server Mode';
const SERVER_PLAN_DESC = 'Low-power mode for the Hermes WSL server (managed by Hermes Lab Controller)';

// Processor power-setting subgroup + value GUID aliases understood by powercfg.
const SUB_PROCESSOR = 'SUB_PROCESSOR';
const PROC_MAX = 'PROCTHROTTLEMAX';
const PROC_MIN = 'PROCTHROTTLEMIN';

function run(file, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const child = execFile(file, args, { windowsHide: true, timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && typeof error.code !== 'undefined' ? error.code : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        error: error ? error.message : ''
      });
    });
    child.on('error', (error) => resolve({ ok: false, code: -1, stdout: '', stderr: '', error: error.message }));
  });
}

function powercfg(args, timeoutMs = 15000) {
  return run('powercfg.exe', args, timeoutMs);
}

function powerShell(command, timeoutMs = 15000) {
  return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], timeoutMs);
}

const GUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

// "Power Scheme GUID: <guid>  (<name>)"
async function getActivePlan() {
  const result = await powercfg(['/getactivescheme'], 8000);
  const guid = (result.stdout.match(GUID_RE) || [])[0] || '';
  const name = (result.stdout.match(/\(([^)]*)\)\s*$/m) || [])[1] || '';
  return { guid, name: name.trim() };
}

async function listPlans() {
  const result = await powercfg(['/list'], 8000);
  const plans = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const guid = (line.match(GUID_RE) || [])[0];
    if (!guid) continue;
    const name = (line.match(/\(([^)]*)\)\s*\*?\s*$/) || [])[1] || '';
    plans.push({ guid, name: name.trim(), active: /\*\s*$/.test(line) });
  }
  return plans;
}

async function planExists(guid) {
  if (!guid) return false;
  const plans = await listPlans();
  return plans.some((p) => p.guid.toLowerCase() === guid.toLowerCase());
}

async function setCpuCap(guid, maxPercent, minPercent = 5) {
  const clampedMax = Math.max(20, Math.min(100, Number(maxPercent) || 100));
  const clampedMin = Math.max(0, Math.min(clampedMax, Number(minPercent) || 0));
  // Apply to both AC and DC so the cap holds regardless of power source.
  for (const verb of ['/setacvalueindex', '/setdcvalueindex']) {
    await powercfg([verb, guid, SUB_PROCESSOR, PROC_MAX, String(clampedMax)], 8000);
    await powercfg([verb, guid, SUB_PROCESSOR, PROC_MIN, String(clampedMin)], 8000);
  }
  return { maxPercent: clampedMax, minPercent: clampedMin };
}

// Ensure the dedicated server plan exists with the requested CPU cap.
// Reuses an existing GUID when still valid; otherwise duplicates Balanced.
// Returns { guid, created, cap }.
async function ensureServerPlan(existingGuid, cpuMax) {
  if (existingGuid && (await planExists(existingGuid))) {
    const cap = await setCpuCap(existingGuid, cpuMax);
    return { guid: existingGuid, created: false, cap };
  }

  const dup = await powercfg(['/duplicatescheme', 'SCHEME_BALANCED'], 10000);
  const guid = (dup.stdout.match(GUID_RE) || [])[0];
  if (!guid) {
    throw new Error(`Failed to create server power plan: ${dup.stderr || dup.error || dup.stdout}`.trim());
  }
  await powercfg(['/changename', guid, SERVER_PLAN_NAME, SERVER_PLAN_DESC], 8000);
  const cap = await setCpuCap(guid, cpuMax);
  return { guid, created: true, cap };
}

async function activatePlan(guid) {
  const result = await powercfg(['/setactive', guid], 8000);
  return result.ok;
}

// Best-effort monitor-off via WM_SYSCOMMAND/SC_MONITORPOWER broadcast. No admin.
async function turnOffDisplay() {
  const command =
    '$sig = \'[DllImport("user32.dll")] public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam);\'; ' +
    '$t = Add-Type -MemberDefinition $sig -Name PowerWin -Namespace Win32 -PassThru; ' +
    '[void]$t::SendMessage(-1, 0x0112, 0xF170, 2)';
  const result = await powerShell(command, 6000);
  return result.ok;
}

// Parse `%USERPROFILE%\.wslconfig` for the headline limits (display only).
function readWslConfig() {
  const file = path.join(os.homedir(), '.wslconfig');
  const out = { exists: false, memory: null, processors: null, swap: null, path: file };
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  out.exists = true;
  const grab = (key) => {
    const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'im'));
    return m ? m[1].trim() : null;
  };
  out.memory = grab('memory');
  out.processors = grab('processors');
  out.swap = grab('swap');
  return out;
}

// Set (or clear) a single key inside the `[wsl2]` section of `.wslconfig`,
// preserving every other line/section. value === null|'' removes the key.
// Takes effect only after `wsl --shutdown`. Returns { ok, path, value }.
function setWslConfigValue(key, value) {
  const file = path.join(os.homedir(), '.wslconfig');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* will create */ }

  const remove = value === null || value === undefined || String(value).trim() === '';
  const line = `${key}=${value}`;
  const keyRe = new RegExp(`^\\s*${key}\\s*=`, 'i');
  const sectionRe = /^\s*\[([^\]]+)\]\s*$/;

  const lines = text.split(/\r?\n/);
  let inWsl2 = false;
  let wsl2HeaderIdx = -1;
  let replaced = false;
  const result = [];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const sec = raw.match(sectionRe);
    if (sec) {
      inWsl2 = sec[1].trim().toLowerCase() === 'wsl2';
      if (inWsl2) wsl2HeaderIdx = result.length;
      result.push(raw);
      continue;
    }
    if (inWsl2 && keyRe.test(raw)) {
      if (!remove) { result.push(line); replaced = true; }
      // when removing, simply skip the line
      continue;
    }
    result.push(raw);
  }

  if (!replaced && !remove) {
    if (wsl2HeaderIdx >= 0) {
      result.splice(wsl2HeaderIdx + 1, 0, line); // insert right under [wsl2]
    } else {
      if (result.length && result[result.length - 1].trim() !== '') result.push('');
      result.push('[wsl2]', line);
    }
  }

  // Tidy trailing blank lines into a single newline.
  let output = result.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '') + '\n';
  fs.writeFileSync(file, output, 'utf8');
  return { ok: true, path: file, value: remove ? null : String(value) };
}

// Categorized `powercfg /requests` parser. Returns { ok, elevated, categories, raw }.
function parseRequests(text) {
  const categories = {};
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\0/g, '').trimEnd();
    if (/^[A-Z_]+:\s*$/.test(line.trim())) {
      current = line.trim().replace(/:$/, '');
      categories[current] = [];
    } else if (current && line.trim() && !/^None\.?$/i.test(line.trim())) {
      categories[current].push(line.trim());
    }
  }
  return categories;
}

// Tries non-elevated first; if access is denied, caller can retry via the
// elevated helper. Returns { ok, accessDenied, categories, raw }.
async function getPowerRequests() {
  const result = await powercfg(['/requests'], 8000);
  const raw = `${result.stdout}\n${result.stderr}`.trim();
  const accessDenied = /access is denied|insufficient privileges|0x?5\b/i.test(raw) || (!result.ok && !result.stdout.trim());
  return {
    ok: result.ok && !accessDenied,
    accessDenied,
    categories: accessDenied ? {} : parseRequests(result.stdout),
    raw
  };
}

// Elevated path for `/requests`: runs the helper via RunAs, which writes the
// output to a temp file we then read back. Triggers a single UAC prompt.
async function getPowerRequestsElevated(helperPath) {
  const outFile = path.join(os.tmpdir(), `hermes-requests-${process.pid}.txt`);
  try {
    fs.rmSync(outFile, { force: true });
  } catch {}
  // Each element is single-quoted exactly once for the PowerShell array literal.
  const q = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const argList = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', helperPath,
    '-Action', 'requests',
    '-OutFile', outFile
  ].map(q).join(',');

  const command =
    `Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList ${argList}`;
  const result = await powerShell(command, 30000);

  let raw = '';
  try {
    raw = fs.readFileSync(outFile, 'utf8');
  } catch {}
  try {
    fs.rmSync(outFile, { force: true });
  } catch {}

  if (!raw.trim()) {
    return { ok: false, accessDenied: false, cancelled: !result.ok, categories: {}, raw: result.stderr || result.error || '' };
  }
  return { ok: true, accessDenied: false, cancelled: false, categories: parseRequests(raw), raw };
}

module.exports = {
  SERVER_PLAN_NAME,
  getActivePlan,
  listPlans,
  planExists,
  setCpuCap,
  ensureServerPlan,
  activatePlan,
  turnOffDisplay,
  readWslConfig,
  setWslConfigValue,
  getPowerRequests,
  getPowerRequestsElevated
};
