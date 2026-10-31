// Full Electron flow under xvfb: the real main process + built renderer drive
// the fake WSL/Hermes harness. Requires `npm run build` first and an X display
// (run via `npm run test:e2e`, which wraps this in xvfb-run).
//
// Playwright is not a dependency of this repo; it is resolved from the global
// install (preinstalled in the cloud VM). Without it the test is skipped.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { createFakeEnv, waitFor } = require('../harness/fake-env.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

function loadPlaywright() {
  try { return require('playwright'); } catch { /* fall through */ }
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(path.join(globalRoot, 'playwright'));
  } catch { return null; }
}

const playwright = loadPlaywright();
const skip = !playwright ? 'playwright not installed'
  : !fs.existsSync(path.join(ROOT, 'dist', 'index.html')) ? 'run `npm run build` first'
    : !process.env.DISPLAY ? 'no DISPLAY (use xvfb-run)' : false;

const SHOTS = process.env.E2E_SCREENSHOT_DIR || '';

test('controller drives profiles end to end against fake Hermes', { skip, timeout: 240000 }, async (t) => {
  const fake = await createFakeEnv({
    profiles: {
      alpha: { gateway: { startDelayMs: 1200 } },
      broken: { gateway: { mode: 'crash-on-start' } }
    }
  });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-userdata-'));
  const winHome = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-winhome-'));
  const env = { ...process.env, ...fake.env, HOME: winHome, APPDATA: path.join(winHome, 'AppData'), HERMES_CONTROLLER_WATCHDOG_POLL_MS: '1500' };
  for (const k of ['HERMES_HOME', 'HERMES_LAB_ROOT', 'HERMES_CONTROLLER_DISTRO', 'HERMES_COMMAND']) delete env[k];

  const app = await playwright._electron.launch({
    executablePath: require(path.join(ROOT, 'node_modules', 'electron')),
    args: ['--no-sandbox', ROOT, `--user-data-dir=${userData}`],
    env
  });
  const proc = app.process();
  const win = await app.firstWindow();
  win.on('dialog', (d) => d.accept());
  const shot = async (name) => { if (SHOTS) await win.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  const panelTitled = (title) => win.locator('section.panel').filter({ has: win.locator('h2', { hasText: new RegExp(`^${title}$`) }) });
  const tab = (label) => win.locator('nav.tabs button', { hasText: label }).click();
  const row = (name) => win.locator(`.prow[data-profile="${name}"]`);
  const phaseOf = (name) => row(name).getAttribute('data-phase');
  const until = async (fn, timeoutMs = 20000) => waitFor(async () => { try { return await fn(); } catch { return false; } }, { timeoutMs, intervalMs: 50 });

  try {
    await win.waitForSelector('.hero');
    assert.ok(['중지됨', '부분 연결'].includes(await win.textContent('.state-title')));

    await t.test('connection settings: test + save via the Settings tab', async () => {
      await tab('설정');
      const panel = panelTitled('Hermes 연결 설정');
      const inputs = panel.locator('input.label-input');
      const values = [fake.config.distro, fake.config.hermesCommand, fake.config.hermesHome, fake.config.labRoot, fake.config.dashboardUrl];
      for (let i = 0; i < values.length; i += 1) await inputs.nth(i).fill(values[i]);
      await panel.locator('button', { hasText: '연결 테스트' }).click();
      await win.waitForSelector('.controller-test-result.ok', { timeout: 20000 });
      assert.equal(await win.locator('.controller-test-result div').count(), 5);
      await panel.locator('button', { hasText: '저장' }).click();
      await until(() => fs.existsSync(path.join(userData, 'controller-config.json')));
      const saved = JSON.parse(fs.readFileSync(path.join(userData, 'controller-config.json'), 'utf8'));
      assert.equal(saved.hermesHome, fake.hermesHome);
      await shot('01-settings-connection');
    });

    await t.test('whole stack start: Status shows connected only once ready', async () => {
      await tab('상태');
      await win.locator('.actions button.primary', { hasText: '시작' }).click();
      await until(async () => (await win.textContent('.state-title')) === '연결됨', 40000);
      assert.match(await win.textContent('.state-message'), /준비가 됐습니다/);
      await shot('02-status-connected');
    });

    await t.test('gateway start: requested/starting are shown before running; real process exists', async () => {
      await tab('프로필');
      await until(async () => (await phaseOf('alpha')) === 'stopped');
      const seen = new Set();
      await row('alpha').locator('button.gw-toggle.start').click();
      await until(async () => { const p = await phaseOf('alpha'); seen.add(p); return p === 'running'; }, 30000);
      assert.ok(seen.has('start-requested') || seen.has('starting'), `intermediate phases seen: ${[...seen]}`);
      assert.ok(fake.isAlive(fake.gatewayPid('alpha')), 'gateway process is alive');
      await win.waitForSelector('.toast', { hasText: '실행 확인' });
      await shot('03-profile-running');
    });

    await t.test('gateway crash on start -> failed with log reason; recovery after fixing', async () => {
      await row('broken').locator('button.gw-toggle.start').click();
      await until(async () => (await phaseOf('broken')) === 'failed', 30000);
      assert.match(await row('broken').locator('.cell-error').textContent(), /exited during startup.*invalid bot token/);
      assert.match(await row('broken').locator('button.gw-toggle.start').textContent(), /다시 시도/);
      await shot('04-profile-failed');
      fake.setGateway('broken', { mode: 'ok' });
      await row('broken').locator('button.gw-toggle.start').click();
      await until(async () => (await phaseOf('broken')) === 'running', 30000);
    });

    await t.test('model change on a running gateway -> restart needed -> restart replaces the process', async () => {
      const before = fake.gatewayPid('alpha');
      await row('alpha').locator('button.gw-toggle.settings').click();
      const modal = win.locator('.profile-modal');
      await modal.locator('select').first().selectOption('gpt-5.4-mini');
      await until(() => /gpt-5\.4-mini/.test(fake.readConfigYaml('alpha')));
      await modal.locator('button', { hasText: '닫기' }).last().click();
      await until(async () => (await row('alpha').locator('.restart-tag').count()) === 1);
      await row('alpha').locator('button.gw-toggle.restart').click();
      await until(async () => (await phaseOf('alpha')) === 'running' && fake.gatewayPid('alpha') !== before, 40000);
      assert.equal(fake.isAlive(before), false);
      await until(async () => (await row('alpha').locator('.restart-tag').count()) === 0);
    });

    await t.test('external crash is detected by the watchdog', async () => {
      fake.killGateway('broken');
      await until(async () => (await row('broken').locator('.crash-tag').count()) === 1, 15000);
      assert.equal(await phaseOf('broken'), 'stopped');
    });

    await t.test('gateway stop: confirmed stopped and process gone', async () => {
      const pid = fake.gatewayPid('alpha');
      await row('alpha').locator('button.gw-toggle.stop').click();
      await until(async () => (await phaseOf('alpha')) === 'stopped', 30000);
      assert.equal(fake.isAlive(pid), false);
      await shot('05-profile-stopped');
    });

    await t.test('settings backup, restore, and rollback on a failed restore', async () => {
      await tab('설정');
      const panel = panelTitled('설정 백업 / 복원');
      await panel.locator('button', { hasText: '지금 백업' }).click();
      await until(async () => (await panel.locator('.settings-backup-row').count()) === 1);

      // Change the connection settings, then restore the backup.
      const conn = panelTitled('Hermes 연결 설정');
      await conn.locator('input.label-input').nth(4).fill('http://127.0.0.1:1/changed');
      await conn.locator('button', { hasText: '저장' }).click();
      const cfgFile = path.join(userData, 'controller-config.json');
      await until(() => /changed/.test(fs.readFileSync(cfgFile, 'utf8')));
      await panel.locator('.settings-backup-row').last().locator('button').click();
      await until(() => !/changed/.test(fs.readFileSync(cfgFile, 'utf8')));
      await win.waitForSelector('.settings-backup-result.ok');
      assert.equal(await conn.locator('input.label-input').nth(4).inputValue(), fake.config.dashboardUrl);

      // Make the restore fail part-way: profile-labels.json is a directory.
      const goodId = (await panel.locator('.settings-backup-row').last().getAttribute('data-backup-id'));
      await conn.locator('input.label-input').nth(4).fill('http://127.0.0.1:2/before-failed-restore');
      await conn.locator('button', { hasText: '저장' }).click();
      await until(() => /before-failed-restore/.test(fs.readFileSync(cfgFile, 'utf8')));
      const bundleFile = path.join(userData, 'settings-backups', `${goodId}.json`);
      const bundle = JSON.parse(fs.readFileSync(bundleFile, 'utf8'));
      bundle.files.profileLabels = { alpha: { label: 'A', desc: '' } };
      fs.writeFileSync(bundleFile, JSON.stringify(bundle));
      fs.mkdirSync(path.join(userData, 'profile-labels.json', 'blocker'), { recursive: true });
      await win.locator(`.settings-backup-row[data-backup-id="${goodId}"] button`).click();
      await win.waitForSelector('.settings-backup-result.err');
      assert.match(await win.textContent('.settings-backup-result.err'), /이전 설정으로 복구됨/);
      assert.match(fs.readFileSync(cfgFile, 'utf8'), /before-failed-restore/, 'controller config rolled back');
      fs.rmSync(path.join(userData, 'profile-labels.json'), { recursive: true, force: true });
      await shot('06-settings-backup');
      // Put the real dashboard URL back for the remaining steps.
      await conn.locator('input.label-input').nth(4).fill(fake.config.dashboardUrl);
      await conn.locator('button', { hasText: '저장' }).click();
      await until(() => fs.readFileSync(cfgFile, 'utf8').includes(fake.config.dashboardUrl));
    });

    await t.test('whole stack stop: Status shows stopped cleanly only when really stopped', async () => {
      // Leave one gateway running so the stop really takes it down.
      await tab('프로필');
      await row('alpha').locator('button.gw-toggle.start').click();
      await until(async () => (await phaseOf('alpha')) === 'running', 30000);
      const crashTagsBefore = await win.locator('.crash-tag').count();
      await tab('상태');
      await win.locator('.actions button.danger', { hasText: '중지' }).click();
      try {
        await until(async () => (await win.textContent('.state-title')) === '중지됨', 40000);
      } catch (error) {
        const calls = fake.wslCalls().slice(-12).map((c) => `${c.at % 100000} ${c.args.slice(0, 4).join(' ')} ${(c.args[4] || '').slice(0, 60)}`);
        throw new Error(`${error.message}\nstate=${fs.readFileSync(path.join(fake.env.FAKE_WSL_ROOT, 'state.json'), 'utf8')} title=${await win.textContent('.state-title')} msg=${await win.textContent('.state-message')}\n${calls.join('\n')}`);
      }
      assert.match(await win.textContent('.state-message'), /정상적으로 중지/);
      // Background polling must not boot the stopped distro again (`wsl -d`
      // starts a stopped distro) nor report the stopped gateways as crashed.
      await new Promise((r) => setTimeout(r, 5000));
      const state = JSON.parse(fs.readFileSync(path.join(fake.env.FAKE_WSL_ROOT, 'state.json'), 'utf8'));
      assert.equal(Boolean(state.running.Ubuntu), false, 'distro stayed stopped');
      await tab('프로필');
      assert.equal(await win.locator('.crash-tag').count(), crashTagsBefore, 'no new crash badges after a user stop');

      // Start the stack again: the gateway the user stopped is not a "crash".
      await tab('상태');
      await win.locator('.actions button.primary', { hasText: '시작' }).click();
      await until(async () => (await win.textContent('.state-title')) === '연결됨', 40000);
      await tab('프로필');
      await new Promise((r) => setTimeout(r, 4000));
      assert.equal(await row('alpha').locator('.crash-tag').count(), 0, 'alpha not flagged as crashed after restart of the stack');
      await shot('07-after-stack-restart');
    });
  } finally {
    // close() can wait on the tray app's quit path; never let it hang the run.
    const closed = await Promise.race([app.close().then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 10000))]);
    if (!closed) { t.diagnostic('app.close() timed out; killing electron'); proc.kill('SIGKILL'); }
    fake.cleanup();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(winHome, { recursive: true, force: true });
  }
});
