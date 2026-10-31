const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { shellQuote, run } = require('../electron/shell.cjs');

function bashEcho(quoted) {
  return execFileSync('bash', ['-c', `printf '%s' ${quoted}`], { encoding: 'utf8' });
}

test('shellQuote round-trips plain values through bash', () => {
  assert.equal(bashEcho(shellQuote('/home/alice/hermes-lab')), '/home/alice/hermes-lab');
  assert.equal(bashEcho(shellQuote('with space')), 'with space');
});

test('shellQuote round-trips single quotes through bash (regression)', () => {
  // Before the fix this produced '''…''' and bash saw an unterminated string.
  assert.equal(bashEcho(shellQuote("/home/o'neil/lab")), "/home/o'neil/lab");
  assert.equal(bashEcho(shellQuote("a'b'c; rm -rf x")), "a'b'c; rm -rf x");
});

test('run resolves (never rejects) for a missing binary', async () => {
  const res = await run('/nonexistent/wsl.exe', ['-l']);
  assert.equal(res.ok, false);
  assert.match(res.error, /ENOENT/);
});
