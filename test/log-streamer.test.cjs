const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeEnv, waitFor } = require('./harness/fake-env.cjs');
const { createLogStreamer } = require('../electron/log-streamer.cjs');

test('streams one profile and the combined log through the fake wsl.exe, even with a space in HERMES_HOME', async () => {
  const fake = (await createFakeEnv({ profiles: { alpha: {}, beta: {} } })).install();
  const home = path.join(fake.root, 'hermes home');
  fs.renameSync(fake.hermesHome, home);
  fs.writeFileSync(path.join(home, 'profiles', 'alpha', 'logs', 'gateway.log'), 'INFO alpha line 1\nINFO alpha line 2\n');
  fs.writeFileSync(path.join(home, 'profiles', 'beta', 'logs', 'gateway.log'), 'INFO beta line\n');
  const lines = [];
  const streamer = createLogStreamer({
    wslPath: fake.wslExe,
    distro: 'Ubuntu',
    hermesHome: home,
    onLine: (name, line) => lines.push([name, line]),
    onEnd: () => {}
  });
  try {
    assert.equal(streamer.start('alpha').ok, true);
    await waitFor(() => lines.some(([n, l]) => n === 'alpha' && l.includes('alpha line 2')));

    lines.length = 0;
    streamer.start('__all__');
    await waitFor(() => lines.some(([, l]) => l === '[beta] INFO beta line') && lines.some(([, l]) => l === '[alpha] INFO alpha line 1'));
    assert.ok(lines.every(([n]) => n === '__all__'));

    assert.equal(streamer.start('x; rm -rf /').ok, false);
  } finally {
    streamer.stop();
    fake.cleanup();
  }
});
