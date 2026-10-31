// Process helpers shared by main.cjs and the tests: execFile wrapper, wsl.exe
// resolution and the bash quoting used when building WSL command lines.

const { execFile } = require('node:child_process');
const path = require('node:path');

function wslPath() {
  return path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'wsl.exe');
}

// POSIX single-quoting: ' becomes '\'' (close, escaped quote, reopen).
function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function run(file, args, timeoutMs = 10000) {
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
    child.on('error', (error) => {
      resolve({ ok: false, code: -1, stdout: '', stderr: '', error: error.message });
    });
  });
}

// runWsl bound to a config getter so a config change is picked up immediately.
function createWslRunner(getConfig) {
  return function runWsl(command, timeoutMs = 10000) {
    const config = getConfig();
    const distro = config && config.distro ? config.distro : 'Ubuntu';
    return run(wslPath(), ['-d', distro, '--', 'bash', '-lc', command], timeoutMs);
  };
}

module.exports = { wslPath, shellQuote, run, createWslRunner };
