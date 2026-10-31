// Pure view logic for gateway lifecycle state, shared by the Profiles table,
// the settings modal and App-level toasts. Kept free of React so it can be
// unit-tested with node:test.
//
// Phases come from electron/gateway-lifecycle.cjs via hermes:gatewayPhase.
// Transitional phases always win; resting phases defer to the latest Hermes
// profile listing, except a failure, which stays visible until the gateway is
// seen running again or the user acts.

export const PHASE_VIEW = {
  'start-requested': { label: '시작 요청됨', tone: 'pending', busy: true },
  starting: { label: '시작 중…', tone: 'pending', busy: true },
  running: { label: '실행 중', tone: 'on', busy: false },
  'stop-requested': { label: '정지 요청됨', tone: 'pending', busy: true },
  stopping: { label: '정지 중…', tone: 'pending', busy: true },
  stopped: { label: '정지됨', tone: 'off', busy: false },
  failed: { label: '실패', tone: 'err', busy: false }
};

const ACTION_LABEL = { start: '시작', stop: '정지', restart: '재시작' };

export function isTransitional(phase) {
  return Boolean(PHASE_VIEW[phase] && PHASE_VIEW[phase].busy);
}

export function gatewayView(profile, entry) {
  const running = Boolean(profile && profile.running);
  let phase = running ? 'running' : 'stopped';
  if (entry && isTransitional(entry.phase)) phase = entry.phase;
  else if (entry && entry.phase === 'failed' && !running) phase = 'failed';
  const view = PHASE_VIEW[phase];
  return {
    phase,
    label: view.label,
    tone: view.tone,
    busy: view.busy,
    running,
    action: entry ? entry.action : null,
    error: phase === 'failed' ? (entry.error || '') : '',
    detail: phase === 'failed' ? (entry.detail || '') : ''
  };
}

export function applyPhaseEvent(phases, entry) {
  if (!entry || !entry.name) return phases;
  return { ...phases, [entry.name]: entry };
}

// Toast for the final result of a start/stop/restart request.
export function gatewayToast(action, result, label) {
  const verb = ACTION_LABEL[action] || action;
  if (!result) return { msg: `${label} 게이트웨이 ${verb} 실패: 응답 없음`, tone: 'err' };
  if (result.busy) {
    const view = PHASE_VIEW[result.phase];
    return { msg: `${label}: 이미 ${view ? view.label : result.phase} 상태예요`, tone: 'info' };
  }
  if (result.ok) {
    if (action === 'stop') return { msg: `${label} 게이트웨이 정지 확인`, tone: 'info' };
    if (action === 'restart') return { msg: `${label} 게이트웨이 재시작 후 실행 확인`, tone: 'ok' };
    return { msg: `${label} 게이트웨이 실행 확인`, tone: 'ok' };
  }
  return { msg: `${label} 게이트웨이 ${verb} 실패: ${result.error || '알 수 없는 오류'}`, tone: 'err' };
}

// Status-tab message after the whole-stack Start/Stop button. The old code
// said "stopped cleanly" for any stop and "start sent" for any start, even
// when WSL was still up or nothing came up at all.
export function serviceMessageKey(action, status) {
  if (!status) return action === 'stop' ? 'stopIncomplete' : 'startFailed';
  if (action === 'stop') {
    if (status.outcome) return status.outcome === 'stopped' ? 'stoppedClean' : 'stopIncomplete';
    return status.wslRunning ? 'stopIncomplete' : 'stoppedClean';
  }
  if (status.outcome === 'running' || status.ready) return 'readyMessage';
  if (status.outcome === 'failed') return 'startFailed';
  if (status.outcome === 'timeout') return 'startTimeout';
  return 'startSent';
}
