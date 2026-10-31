// Streams a profile's gateway log into the renderer via `tail -F`.
//
// Uses spawn (not exec) so output arrives line-by-line in real time. Only one
// profile streams at a time — starting a new one tears down the previous child.
//
// The authoritative live log is `gateway.log` (Hermes writes structured logs
// there regardless of stdout). `gateway.controller.log` only has stdout/banner
// from controller-started gateways and is often empty, so we prefer gateway.log
// and fall back. That selection needs a shell `$var`, and wsl.exe strips `$`
// from inline commands — so the script is smuggled through base64 (no `$`).

const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { shellQuote } = require('./shell.cjs');

function b64wrap(script) {
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  return `echo ${b64} | base64 -d | bash`;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;

function createLogStreamer(deps) {
  const { wslPath, distro, hermesHome, onLine, onEnd } = deps;
  let child = null;
  let current = null;

  function stop() {
    if (child) {
      try { child.kill(); } catch { /* already gone */ }
      child = null;
    }
    current = null;
  }

  function start(name = '__all__') {
    if (name !== '__all__' && !/^[A-Za-z0-9_-]+$/.test(String(name))) return { ok: false, error: 'invalid profile name' };
    stop();
    current = name;
    const streamName = name;
    let script;
    if (name === '__all__') {
      script = `python3 - <<'PY'
import subprocess, sys
from pathlib import Path
home = Path(${JSON.stringify(hermesHome || '')}) / 'profiles'
files = []
if home.exists():
    for profile in sorted(p for p in home.iterdir() if p.is_dir()):
        log = profile / 'logs' / 'gateway.log'
        fallback = profile / 'logs' / 'gateway.controller.log'
        if log.exists():
            files.append((profile.name, log))
        elif fallback.exists():
            files.append((profile.name, fallback))
if not files:
    print('[all] 로그 파일을 찾지 못했습니다.', flush=True)
    sys.exit(0)
cmd = ['tail', '-n', '80', '-F'] + [str(path) for _, path in files]
proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, errors='replace')
current = None
path_to_name = {str(path): name for name, path in files}
for raw in proc.stdout:
    line = raw.rstrip('\\n')
    if line.startswith('==> ') and line.endswith(' <=='):
        current = path_to_name.get(line[4:-4], line[4:-4])
        continue
    prefix = current or 'all'
    print(f'[{prefix}] {line}', flush=True)
PY`;
    } else {
      const base = `${hermesHome}/profiles/${name}/logs`;
      script =
        `f=${shellQuote(`${base}/gateway.log`)}; ` +
        `if [ ! -s "$f" ]; then f=${shellQuote(`${base}/gateway.controller.log`)}; fi; ` +
        `tail -n 250 -F "$f" 2>/dev/null`;
    }

    child = spawn(wslPath, ['-d', distro, '--', 'bash', '-lc', b64wrap(script)], { windowsHide: true });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (raw) => {
      if (current !== streamName) return;
      const line = raw.replace(ANSI, '').replace(/\0/g, '');
      if (typeof onLine === 'function') onLine(streamName, line);
    });

    child.on('close', () => {
      if (current === streamName && typeof onEnd === 'function') onEnd(streamName);
    });
    child.on('error', () => {
      if (current === streamName && typeof onEnd === 'function') onEnd(streamName);
    });

    return { ok: true, name };
  }

  return {
    start,
    stop,
    current: () => current
  };
}

module.exports = { createLogStreamer };
