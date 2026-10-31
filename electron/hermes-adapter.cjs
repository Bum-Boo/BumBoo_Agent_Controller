// Adapter over the `hermes` CLI inside WSL.
//
// Profiles and their messaging gateways are unified here: listProfiles()
// returns each profile enriched with its gateway running state and the
// per-platform connection status (telegram/discord/...) read straight from
// the profile's gateway_state.json — which is the source of truth the gateway
// itself writes. The rest of the app only talks to this module.
//
// Per-profile gateway targeting uses the top-level `--profile <name>` flag
// (confirmed from the live gateway's cmdline: `hermes --profile sense gateway
// run --replace`). Start is detached so it survives the WSL call returning;
// stop reads the profile's gateway.pid via `gateway stop`.
//
// Injected `runWsl(command, timeoutMs)` resolves to
//   { ok, code, stdout, stderr, error }.

const { shellQuote } = require('./shell.cjs');

const PROFILE_NAME = /^[A-Za-z0-9_-]+$/;

function validName(name) {
  return typeof name === 'string' && PROFILE_NAME.test(name);
}

function createHermesAdapter(runWsl, config) {
  const home = config.hermesHome;
  // Every user-supplied path/command is quoted: settings may contain spaces or
  // quotes, and an empty labRoot must not turn into a bare `cd` (= $HOME).
  const qHome = shellQuote(home);
  const hermesBin = shellQuote(config.hermesCommand || 'hermes');
  const envPrefix = `${config.labRoot ? `cd ${shellQuote(config.labRoot)} && ` : ''}HERMES_HOME=${qHome} `;
  // Python string literal for HERMES_HOME (JSON strings are valid Python).
  const pyHome = JSON.stringify(home || '');

  const MODEL_OPTIONS = [
    { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai-codex', baseUrl: 'https://chatgpt.com/backend-api/codex' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', provider: 'openai-codex', baseUrl: 'https://chatgpt.com/backend-api/codex' },
    { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', provider: 'openai-codex', baseUrl: 'https://chatgpt.com/backend-api/codex' },
    { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (CLI)', provider: 'anthropic', baseUrl: 'http://127.0.0.1:8788' }
  ];

  const REASONING_OPTIONS = [
    { id: '', label: '기본값' },
    { id: 'minimal', label: 'minimal' },
    { id: 'low', label: 'low' },
    { id: 'medium', label: 'medium' },
    { id: 'high', label: 'high' },
    { id: 'xhigh', label: 'xhigh' }
  ];

  function hermes(args, timeoutMs = 12000) {
    return runWsl(`${envPrefix}${hermesBin} ${args}`, timeoutMs);
  }

  // wsl.exe (via execFile) strips `$var`/`$(...)` from the inline command
  // string before bash sees them. Any script that needs shell variables must
  // be smuggled in base64 (which has no `$`) and decoded by an inner bash.
  function b64wrap(script) {
    const b64 = Buffer.from(script, 'utf8').toString('base64');
    return `echo ${b64} | base64 -d | bash`;
  }

  function modelOptions() {
    return { ok: true, models: MODEL_OPTIONS, reasoning: REASONING_OPTIONS };
  }

  // Strip box-drawing rules, headers and ANSI so parsing is stable.
  function meaningfulLines(stdout) {
    return stdout
      .split(/\r?\n/)
      // eslint-disable-next-line no-control-regex
      .map((l) => l.replace(/\[[0-9;]*m/g, '').replace(/\0/g, ''))
      .filter((l) => l.trim().length > 0)
      .filter((l) => !/^[\s─—–-]+$/.test(l));
  }

  // Dump every profile's gateway_state.json in one shot, framed by @@@<name>.
  function dumpStatesCommand() {
    return (
      `for f in ${qHome}/profiles/*/gateway_state.json; do ` +
      `[ -e "$f" ] || continue; ` +
      `n=$(basename "$(dirname "$f")"); ` +
      `echo "@@@$n"; cat "$f"; echo; ` +
      `done`
    );
  }

  // Parse the framed dump into { profileName: stateObject }.
  function parseStates(stdout) {
    const states = {};
    const lines = stdout.split(/\r?\n/);
    let name = null;
    let buf = [];
    const flush = () => {
      if (name && buf.length) {
        try {
          states[name] = JSON.parse(buf.join('\n'));
        } catch {
          /* ignore malformed */
        }
      }
      buf = [];
    };
    for (const line of lines) {
      const m = line.match(/^@@@(.+)$/);
      if (m) {
        flush();
        name = m[1].trim();
      } else if (name) {
        buf.push(line);
      }
    }
    flush();
    return states;
  }

  function dumpProfileConfigsCommand() {
    return `HERMES_HOME=${qHome} python3 - <<'PY'
import json
from pathlib import Path
try:
    import yaml
except Exception:
    yaml = None

base = Path(${pyHome}) / 'profiles'
out = {}
if base.exists() and yaml is not None:
    for profile_dir in sorted(p for p in base.iterdir() if p.is_dir()):
        cfg_path = profile_dir / 'config.yaml'
        if not cfg_path.exists():
            continue
        try:
            cfg = yaml.safe_load(cfg_path.read_text(encoding='utf-8')) or {}
        except Exception:
            continue
        model = cfg.get('model') or {}
        agent = cfg.get('agent') or {}
        out[profile_dir.name] = {
            'provider': model.get('provider'),
            'model': model.get('default'),
            'base_url': model.get('base_url'),
            'reasoning_effort': agent.get('reasoning_effort')
        }
print(json.dumps(out, ensure_ascii=False))
PY`;
  }

  // platforms object -> [{ name, state }] (connected/disconnected/error/...)
  function platformsFromState(state, running) {
    const out = [];
    if (state && state.platforms && typeof state.platforms === 'object') {
      for (const [pname, info] of Object.entries(state.platforms)) {
        const raw = info && typeof info === 'object' ? info.state : info;
        out.push({ name: pname, state: running ? (raw || 'unknown') : 'disconnected' });
      }
    }
    return out;
  }

  // List profiles, each enriched with gateway running state + platforms.
  async function listProfiles() {
    const [listRes, stateRes, configRes] = await Promise.all([
      hermes('profile list', 12000),
      runWsl(b64wrap(dumpStatesCommand()), 10000),
      runWsl(b64wrap(dumpProfileConfigsCommand()), 10000)
    ]);

    if (!listRes.ok && !listRes.stdout.trim()) {
      return { ok: false, error: listRes.stderr || listRes.error || 'profile list failed', profiles: [] };
    }

    const states = parseStates(stateRes.stdout || '');
    let configs = {};
    try { configs = JSON.parse(configRes.stdout || '{}'); } catch { configs = {}; }
    const profiles = [];
    for (const line of meaningfulLines(listRes.stdout)) {
      if (/\bProfile\b/.test(line) && /\bModel\b/.test(line)) continue; // header
      const current = line.includes('◆');
      const cleaned = line.replace(/◆/g, ' ').trim();
      const cols = cleaned.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
      if (cols.length < 2) continue;
      const [name, model, gateway, alias] = cols;
      const dash = (v) => (!v || v === '—' || v === '-' ? null : v);
      const running = (gateway || '').toLowerCase() === 'running';
      const state = states[name];
      const profileConfig = configs[name] || {};
      profiles.push({
        name,
        model: profileConfig.model || dash(model),
        provider: profileConfig.provider || null,
        baseUrl: profileConfig.base_url || null,
        reasoning: profileConfig.reasoning_effort || '',
        running,
        alias: dash(alias),
        current,
        pid: state && state.pid ? state.pid : null,
        platforms: platformsFromState(state, running)
      });
    }
    return { ok: true, profiles };
  }

  function findModelOption(modelId) {
    return MODEL_OPTIONS.find((m) => m.id === modelId) || null;
  }

  function findReasoningOption(reasoningId) {
    const normalized = reasoningId || '';
    return REASONING_OPTIONS.find((r) => r.id === normalized) || null;
  }

  async function setProfileModelSettings(name, patch = {}) {
    if (!validName(name)) {
      return { ok: false, error: 'invalid profile name' };
    }

    const commands = [];
    if (Object.prototype.hasOwnProperty.call(patch, 'model')) {
      const option = findModelOption(patch.model);
      if (!option) return { ok: false, error: 'unsupported model' };
      commands.push(`${hermesBin} --profile ${shellQuote(name)} config set model.provider ${shellQuote(option.provider)}`);
      commands.push(`${hermesBin} --profile ${shellQuote(name)} config set model.default ${shellQuote(option.id)}`);
      commands.push(`${hermesBin} --profile ${shellQuote(name)} config set model.base_url ${shellQuote(option.baseUrl)}`);
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'reasoning')) {
      const reasoning = patch.reasoning || '';
      if (!findReasoningOption(reasoning)) return { ok: false, error: 'unsupported reasoning effort' };
      commands.push(`${hermesBin} --profile ${shellQuote(name)} config set agent.reasoning_effort ${shellQuote(reasoning)}`);
    }

    if (!commands.length) return { ok: true, output: 'no changes' };

    const script = [
      'set -euo pipefail',
      `backup_dir=${qHome}/backups/controller-profile-models/"$(date +%Y%m%d-%H%M%S)-${name}"`,
      'mkdir -p "$backup_dir"',
      `cp -a ${shellQuote(`${home}/profiles/${name}/config.yaml`)} "$backup_dir/config.yaml"`,
      ...commands,
      `${hermesBin} --profile ${shellQuote(name)} config check >/dev/null`,
      'echo "$backup_dir"'
    ].join('\n');
    const result = await runWsl(b64wrap(script), 30000);
    return {
      ok: result.ok,
      output: (result.stdout || result.stderr || '').trim(),
      error: result.ok ? '' : (result.stderr || result.error || 'config update failed')
    };
  }


  async function listProfileBackups(name) {
    if (!validName(name)) return { ok: false, backups: [], error: 'invalid profile name' };
    const script = `python3 - <<'PY'
import json, os, re
from pathlib import Path
name = ${JSON.stringify(name)}
base = Path(${pyHome}) / 'backups' / 'controller-profile-models'
items = []
if base.exists():
    for d in base.iterdir():
        if not d.is_dir() or not d.name.endswith('-' + name):
            continue
        cfg = d / 'config.yaml'
        if not cfg.exists():
            continue
        st = cfg.stat()
        items.append({'id': d.name, 'path': str(d), 'created': d.name[:15], 'mtime': st.st_mtime})
items.sort(key=lambda x: x['mtime'], reverse=True)
print(json.dumps(items[:12], ensure_ascii=False))
PY`;
    const result = await runWsl(b64wrap(script), 10000);
    try { return { ok: result.ok, backups: JSON.parse(result.stdout || '[]') }; }
    catch { return { ok: false, backups: [], error: result.stderr || result.error || 'backup parse failed' }; }
  }

  async function restoreProfileBackup(name, backupId) {
    if (!validName(name)) return { ok: false, error: 'invalid profile name' };
    if (!backupId || !/^[A-Za-z0-9_-]+$/.test(backupId) || !backupId.endsWith(`-${name}`)) return { ok: false, error: 'invalid backup id' };
    const script = [
      'set -euo pipefail',
      `backup=${shellQuote(`${home}/backups/controller-profile-models/${backupId}/config.yaml`)}`,
      `target=${shellQuote(`${home}/profiles/${name}/config.yaml`)}`,
      'test -f "$backup"',
      `rollback_dir=${qHome}/backups/controller-profile-restore/"$(date +%Y%m%d-%H%M%S)-${name}"`,
      'mkdir -p "$rollback_dir"',
      'cp -a "$target" "$rollback_dir/config.yaml"',
      'cp -a "$backup" "$target"',
      `${hermesBin} --profile ${shellQuote(name)} config check >/dev/null`,
      'echo "$rollback_dir"'
    ].join('\n');
    const result = await runWsl(b64wrap(script), 30000);
    return { ok: result.ok, output: (result.stdout || result.stderr || '').trim(), error: result.ok ? '' : (result.stderr || result.error || 'restore failed') };
  }

  async function profileLogSummary(name) {
    if (!validName(name)) return { ok: false, error: 'invalid profile name' };
    const script = `python3 - <<'PY'
import json, re
from pathlib import Path
name = ${JSON.stringify(name)}
base = Path(${pyHome}) / 'profiles' / name / 'logs'
paths = [base / 'gateway.log', base / 'gateway.controller.log']
lines = []
source = ''
for path in paths:
    if path.exists() and path.stat().st_size:
        source = str(path)
        data = path.read_text(encoding='utf-8', errors='replace').splitlines()
        lines = data[-350:]
        break
patterns = {
    'error': re.compile(r'error|exception|traceback|failed|failure', re.I),
    'warn': re.compile(r'warn|warning|timeout|retry', re.I),
}
errors = [ln[-260:] for ln in lines if patterns['error'].search(ln)]
warns = [ln[-260:] for ln in lines if patterns['warn'].search(ln)]
last_nonempty = next((ln[-260:] for ln in reversed(lines) if ln.strip()), '')
out = {
    'ok': True,
    'source': source,
    'lineCount': len(lines),
    'errorCount': len(errors),
    'warnCount': len(warns),
    'lastLine': last_nonempty,
    'recentIssues': (errors[-5:] if errors else warns[-5:])
}
print(json.dumps(out, ensure_ascii=False))
PY`;
    const result = await runWsl(b64wrap(script), 10000);
    try { return JSON.parse(result.stdout || '{}'); }
    catch { return { ok: false, error: result.stderr || result.error || 'log summary parse failed' }; }
  }

  // Set the sticky default profile. Safe, idempotent.
  async function useProfile(name) {
    if (!validName(name)) return { ok: false, error: 'invalid profile name' };
    const result = await hermes(`profile use ${shellQuote(name)}`, 12000);
    return { ok: result.ok, output: (result.stdout || result.stderr || '').trim() };
  }

  // Start a specific profile's gateway so it OUTLIVES this call.
  //
  // `setsid nohup ... &` does NOT survive here: when the wsl.exe-launched bash
  // exits, WSL tears down the transient session and kills the still-starting
  // Python before it writes a byte (empty log, profile stays "stopped"). tmux
  // is the reliable detach on this box — its server reparents to init and keeps
  // the gateway alive (this is how `sense` survives). The tmux window closes by
  // itself when the gateway stops, so no session leaks.
  async function gatewayStartProfile(name) {
    if (!validName(name)) return { ok: false, error: 'invalid profile name' };
    const session = `gw-${name}`;
    const logDir = `${home}/profiles/${name}/logs`;
    const logFile = `${logDir}/gateway.controller.log`;
    const inner =
      `${envPrefix}${hermesBin} --profile ${name} gateway run --replace >> ${shellQuote(logFile)} 2>&1`;
    const cmd =
      `mkdir -p ${shellQuote(logDir)}; ` +
      `tmux kill-session -t ${shellQuote(session)} 2>/dev/null; ` +
      `tmux new-session -d -s ${shellQuote(session)} ${shellQuote(inner)}; ` +
      `echo started`;
    const result = await runWsl(cmd, 15000);
    return { ok: result.ok, output: (result.stdout || result.stderr || '').trim() };
  }

  // Stop a specific profile's gateway via its pidfile.
  async function gatewayStopProfile(name) {
    if (!validName(name)) return { ok: false, error: 'invalid profile name' };
    const result = await hermes(`--profile ${shellQuote(name)} gateway stop`, 20000);
    return { ok: result.ok, output: (result.stdout || result.stderr || '').trim() };
  }

  // Process-level probe for one gateway, used to tell "start request sent"
  // apart from "actually running": is the controller's tmux session alive, is
  // the pid from gateway.pid / gateway_state.json alive (zombies count as
  // dead), plus the last lines the launch wrote, for failure messages.
  async function gatewayProcessStatus(name) {
    if (!validName(name)) return { ok: false, error: 'invalid profile name' };
    const script = `python3 - <<'PY'
import json, os, subprocess
from pathlib import Path
name = ${JSON.stringify(name)}
base = Path(${pyHome}) / 'profiles' / name

def read_pid():
    for f in (base / 'gateway.pid', base / 'gateway_state.json'):
        try:
            raw = f.read_text(encoding='utf-8').strip()
        except Exception:
            continue
        try:
            return int(raw)
        except ValueError:
            pass
        try:
            pid = json.loads(raw).get('pid')
            if pid:
                return int(pid)
        except Exception:
            pass
    return None

def alive(pid):
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        pass
    try:
        stat = Path('/proc/%d/stat' % pid).read_text()
        return stat.rsplit(')', 1)[1].split()[0] != 'Z'
    except Exception:
        return True

try:
    session = subprocess.run(['tmux', 'has-session', '-t', 'gw-' + name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
except Exception:
    session = False
pid = read_pid()
tail = []
for f in (base / 'logs' / 'gateway.controller.log', base / 'logs' / 'gateway.log'):
    try:
        lines = [ln for ln in f.read_text(encoding='utf-8', errors='replace').splitlines() if ln.strip()]
    except Exception:
        continue
    if lines:
        tail = lines[-8:]
        break
print(json.dumps({'ok': True, 'sessionAlive': session, 'pid': pid, 'running': alive(pid), 'logTail': '\\n'.join(ln[-300:] for ln in tail)}, ensure_ascii=False))
PY`;
    const result = await runWsl(b64wrap(script), 10000);
    try { return JSON.parse(result.stdout || '{}'); }
    catch { return { ok: false, error: result.stderr || result.error || 'process probe failed' }; }
  }

  return {
    listProfiles, modelOptions, setProfileModelSettings, listProfileBackups,
    restoreProfileBackup, profileLogSummary, useProfile, gatewayStartProfile, gatewayStopProfile,
    gatewayProcessStatus
  };
}

module.exports = { createHermesAdapter, validName };
