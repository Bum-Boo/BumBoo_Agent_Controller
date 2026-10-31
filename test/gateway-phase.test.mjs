import test from 'node:test';
import assert from 'node:assert/strict';
import { gatewayView, applyPhaseEvent, gatewayToast, serviceMessageKey, isTransitional } from '../src/gateway-phase.mjs';

const up = { name: 'alpha', running: true };
const down = { name: 'alpha', running: false };

test('no lifecycle entry: view follows the Hermes listing', () => {
  assert.equal(gatewayView(up, undefined).phase, 'running');
  assert.equal(gatewayView(down, undefined).phase, 'stopped');
});

test('transitional phases win over the (stale) listing and mark the row busy', () => {
  for (const phase of ['start-requested', 'starting', 'stop-requested', 'stopping']) {
    const v = gatewayView(phase.startsWith('start') ? down : up, { phase });
    assert.equal(v.phase, phase);
    assert.equal(v.busy, true);
    assert.equal(v.tone, 'pending');
    assert.ok(isTransitional(phase));
  }
});

test('"start requested" is distinct from "running": a sent command is not shown as running', () => {
  const v = gatewayView(down, { phase: 'start-requested' });
  assert.notEqual(v.phase, 'running');
  assert.equal(v.label, '시작 요청됨');
});

test('failed is sticky while down, cleared once Hermes reports running', () => {
  const entry = { phase: 'failed', error: 'gateway exited during startup', detail: 'ERROR invalid bot token' };
  const failed = gatewayView(down, entry);
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.tone, 'err');
  assert.match(failed.detail, /invalid bot token/);
  assert.equal(gatewayView(up, entry).phase, 'running');
  assert.equal(gatewayView(up, entry).error, '');
});

test('resting entry phases defer to the listing (external stop/crash)', () => {
  assert.equal(gatewayView(down, { phase: 'running' }).phase, 'stopped');
  assert.equal(gatewayView(up, { phase: 'stopped' }).phase, 'running');
});

test('applyPhaseEvent replaces one profile immutably', () => {
  const a = { beta: { name: 'beta', phase: 'running' } };
  const b = applyPhaseEvent(a, { name: 'alpha', phase: 'starting' });
  assert.notEqual(a, b);
  assert.equal(b.alpha.phase, 'starting');
  assert.equal(b.beta.phase, 'running');
  assert.equal(applyPhaseEvent(a, null), a);
});

test('toasts report confirmed outcomes, not requests', () => {
  assert.deepEqual(gatewayToast('start', { ok: true, phase: 'running' }, 'Alpha'), { msg: 'Alpha 게이트웨이 실행 확인', tone: 'ok' });
  assert.equal(gatewayToast('stop', { ok: true, phase: 'stopped' }, 'Alpha').msg, 'Alpha 게이트웨이 정지 확인');
  assert.equal(gatewayToast('restart', { ok: true, phase: 'running' }, 'Alpha').tone, 'ok');
  const failed = gatewayToast('start', { ok: false, phase: 'failed', error: 'gateway exited during startup' }, 'Alpha');
  assert.equal(failed.tone, 'err');
  assert.match(failed.msg, /시작 실패: gateway exited during startup/);
  assert.match(gatewayToast('stop', { ok: false, busy: true, phase: 'starting' }, 'Alpha').msg, /이미 시작 중/);
  assert.equal(gatewayToast('start', undefined, 'Alpha').tone, 'err');
});

test('service message: stop only says "stopped cleanly" when it really stopped (regression)', () => {
  assert.equal(serviceMessageKey('stop', { outcome: 'stopped', wslRunning: false }), 'stoppedClean');
  assert.equal(serviceMessageKey('stop', { outcome: 'incomplete', wslRunning: true }), 'stopIncomplete');
  // Old code: `next.ready ? 'readyMessage' : action === 'stop' ? 'stoppedClean' : 'startSent'`
  assert.equal(serviceMessageKey('stop', { wslRunning: true, ready: false }), 'stopIncomplete');
});

test('service message: start distinguishes ready / timeout / failed', () => {
  assert.equal(serviceMessageKey('start', { outcome: 'running', ready: true }), 'readyMessage');
  assert.equal(serviceMessageKey('start', { outcome: 'timeout', ready: false }), 'startTimeout');
  assert.equal(serviceMessageKey('start', { outcome: 'failed', ready: false }), 'startFailed');
  assert.equal(serviceMessageKey('start', { ready: false }), 'startSent');
  assert.equal(serviceMessageKey('start', null), 'startFailed');
});
