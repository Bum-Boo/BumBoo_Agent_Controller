import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Activity, Bot, Check, History, MessageCircle, Play,
  RefreshCw, RotateCcw, Send, Settings, ShieldCheck, Square, Star, X
} from 'lucide-react';
import { Panel, ToggleSwitch } from '../components.jsx';

const PLATFORM_ICON = { telegram: Send, discord: MessageCircle };
const FILTERS = [
  { id: 'all', label: '전체' },
  { id: 'running', label: '실행 중' },
  { id: 'restart', label: '재시작 필요' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
  { id: 'problems', label: '주의' }
];

function PlatformBadge({ platform }) {
  const Icon = PLATFORM_ICON[platform.name] || MessageCircle;
  const connected = platform.state === 'connected';
  const tone = connected ? 'on' : platform.state === 'error' ? 'err' : 'off';
  return (
    <span className={`pf-badge ${tone}`} title={`${platform.name}: ${platform.state}`}>
      <Icon size={12} />
      <span className="pf-name">{platform.name}</span>
      <span className="pf-dot" />
    </span>
  );
}

function ProfileSettingSelect({ label, value, options, disabled, onChange }) {
  return (
    <label className="profile-setting-select">
      <span>{label}</span>
      <select value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>{opt.label || opt.id || '기본값'}</option>
        ))}
      </select>
    </label>
  );
}

function formatShortTime(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString('ko-KR', { hour12: false }); }
  catch { return value; }
}

function ProfileSettingsModal({
  profile, label, runtimeState, opsState, modelOptions, reasoningOptions, busy,
  onClose, onSetDefault, onUpdateModelSettings, onSaveLabel, onRestart,
  onRestoreBackup, onLoadBackups, onLoadLogSummary
}) {
  const [labelText, setLabelText] = useState(label?.label || '');
  const [descText, setDescText] = useState(label?.desc || '');
  const [restartNotice, setRestartNotice] = useState(null);
  const [backups, setBackups] = useState([]);
  const [logSummary, setLogSummary] = useState(null);
  const [sectionBusy, setSectionBusy] = useState(false);

  useEffect(() => {
    setLabelText(label?.label || '');
    setDescText(label?.desc || '');
    setRestartNotice(null);
    setBackups([]);
    setLogSummary(null);
    if (!profile) return;
    let active = true;
    setSectionBusy(true);
    Promise.all([
      onLoadBackups(profile.name).catch(() => ({ backups: [] })),
      onLoadLogSummary(profile.name).catch(() => null)
    ]).then(([backupResult, summary]) => {
      if (!active) return;
      setBackups((backupResult && backupResult.backups) || []);
      setLogSummary(summary);
    }).finally(() => { if (active) setSectionBusy(false); });
    return () => { active = false; };
  }, [label, profile?.name]);

  if (!profile) return null;

  const displayName = label?.label || profile.name;
  const effectiveModelOptions = modelOptions.some((opt) => opt.id === profile.model)
    ? modelOptions
    : [{ id: profile.model || '', label: profile.model ? `${profile.model} (현재값)` : '—' }, ...modelOptions];
  const effectiveReasoningOptions = reasoningOptions.length
    ? reasoningOptions
    : [{ id: profile.reasoning || '', label: profile.reasoning || '기본값' }];
  const watchdog = opsState?.watchdog || {};
  const watchdogConfig = watchdog.config || {};
  const watchdogState = watchdog.state || {};
  const watchdogDesired = Array.isArray(watchdogState.desired) && watchdogState.desired.includes(profile.name);
  const retryInfo = Array.isArray(watchdogState.retries)
    ? watchdogState.retries.find((item) => item.name === profile.name)
    : null;
  const profileHistory = (opsState?.history || []).filter((item) => item.profile === profile.name).slice(0, 8);

  const saveLabel = async () => {
    await onSaveLabel(profile.name, labelText, descText);
  };

  const showRestartNotice = (title, body) => setRestartNotice({ title, body });

  const changeRuntimeSetting = async (patch, labelTextForNotice) => {
    const result = await onUpdateModelSettings(profile.name, patch);
    if (result && result.ok && result.requiresRestart) {
      showRestartNotice(
        `${labelTextForNotice} 변경은 gateway 재시작이 필요해`,
        '지금 실행 중인 gateway는 이미 만들어진 agent와 provider 연결을 들고 있어. config 파일은 저장됐지만, 실행 중인 세션에 즉시 보장 적용되지 않으니 재시작하면 새 모델·추론 설정으로 확실히 반영돼.'
      );
    }
  };

  const restoreBackup = async (backupId) => {
    const result = await onRestoreBackup(profile.name, backupId);
    if (result && result.ok && result.requiresRestart) {
      showRestartNotice(
        '백업 복원은 gateway 재시작이 필요해',
        'config.yaml은 이전 백업으로 되돌렸지만, 실행 중인 gateway는 기존 agent 설정을 계속 들고 있을 수 있어. 재시작하면 복원된 설정으로 확실히 반영돼.'
      );
    }
    const next = await onLoadBackups(profile.name).catch(() => ({ backups: [] }));
    setBackups((next && next.backups) || []);
  };

  const restartNow = async () => {
    const result = await onRestart(profile);
    if (result && result.ok) setRestartNotice(null);
  };

  return (
    <div className="profile-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="profile-modal" role="dialog" aria-modal="true" aria-label={`${displayName} 설정`} onClick={(e) => e.stopPropagation()}>
        <header className="profile-modal-head">
          <div>
            <h3>{displayName} 설정</h3>
            <p>{profile.name} · {profile.provider || 'provider 미지정'}</p>
          </div>
          <button className="ghost small icon-only" title="닫기" onClick={onClose}><X size={15} /></button>
        </header>

        <div className="profile-modal-body">
          <section className="profile-modal-section">
            <h4>모델과 추론</h4>
            <div className="profile-modal-grid">
              <ProfileSettingSelect
                label="모델"
                value={profile.model || ''}
                options={effectiveModelOptions}
                disabled={busy}
                onChange={(value) => changeRuntimeSetting({ model: value }, '모델')}
              />
              <ProfileSettingSelect
                label="추론 정도"
                value={profile.reasoning || ''}
                options={effectiveReasoningOptions}
                disabled={busy}
                onChange={(value) => changeRuntimeSetting({ reasoning: value }, '추론 정도')}
              />
            </div>
            <p className="profile-help">
              추론 정도의 기본값은 “명시하지 않음/자동”이야. Codex 계열에서는 대체로 medium처럼 보면 되고, Claude CLI 연결은 Claude CLI 기본 동작을 따른다.
              모델·추론 정도는 실행 중인 gateway에 즉시 보장 적용되지 않고, 재시작하면 확실히 반영돼.
            </p>
            {(restartNotice || runtimeState?.restartNeeded) ? (
              <div className="profile-restart-notice">
                <div>
                  <strong>{restartNotice?.title || '재시작 필요 상태야'}</strong>
                  <p>{restartNotice?.body || runtimeState?.reason || '저장된 설정이 실행 중 gateway에 아직 확실히 반영되지 않았어.'}</p>
                  {runtimeState?.changedAt ? <small>변경 시각: {formatShortTime(runtimeState.changedAt)}</small> : null}
                </div>
                <div className="profile-restart-actions">
                  <button className="ghost small" disabled={busy} onClick={() => setRestartNotice(null)}>나중에</button>
                  <button className="gw-toggle restart" disabled={busy} onClick={restartNow}>지금 재시작</button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="profile-modal-section">
            <h4>백업 복원</h4>
            <p className="profile-muted-line">모델/추론 변경 전 자동 백업된 config.yaml을 복원할 수 있어. 실행 중이면 복원 후 재시작이 필요해.</p>
            <div className="profile-backup-list">
              {sectionBusy ? <span className="pf-none">읽는 중…</span> : backups.length ? backups.map((b) => (
                <div className="profile-backup-row" key={b.id}>
                  <span>{b.id}</span>
                  <button className="ghost small" disabled={busy} onClick={() => restoreBackup(b.id)}><RotateCcw size={12} /> 복원</button>
                </div>
              )) : <span className="pf-none">사용 가능한 백업 없음</span>}
            </div>
          </section>

          <section className="profile-modal-section">
            <h4>표시 이름</h4>
            <div className="profile-label-form">
              <input className="label-input" type="text" maxLength={30} placeholder={`표시 이름 (비우면 "${profile.name}")`} value={labelText} onChange={(e) => setLabelText(e.target.value)} />
              <input className="label-input desc" type="text" maxLength={60} placeholder="설명 (선택)" value={descText} onChange={(e) => setDescText(e.target.value)} />
              <button className="ghost small" disabled={busy} onClick={saveLabel}><Check size={13} /> 저장</button>
            </div>
          </section>

          <section className="profile-modal-section profile-two-col">
            <div>
              <h4><Activity size={14} /> 최근 로그 요약</h4>
              {logSummary && logSummary.ok ? (
                <div className="profile-summary-box">
                  <span>오류 {logSummary.errorCount || 0} · 경고 {logSummary.warnCount || 0}</span>
                  <small>{logSummary.lastLine || '최근 로그 없음'}</small>
                  {(logSummary.recentIssues || []).slice(-3).map((line, idx) => <code key={idx}>{line}</code>)}
                </div>
              ) : <span className="pf-none">로그 요약 없음</span>}
            </div>
            <div>
              <h4><ShieldCheck size={14} /> 자동 복구</h4>
              <div className="profile-summary-box">
                <span>{watchdogConfig.autoRestartEnabled ? '자동 재시작 켜짐' : '자동 재시작 꺼짐'} · 최대 {watchdogConfig.autoRestartMax || 3}회</span>
                <small>{watchdogDesired ? 'watchdog 추적 대상' : '현재 추적 대상 아님'}</small>
                {retryInfo ? <small>최근 재시도 {retryInfo.count}회</small> : null}
              </div>
            </div>
          </section>

          <section className="profile-modal-section">
            <h4><History size={14} /> 변경 이력</h4>
            <div className="profile-history-list">
              {profileHistory.length ? profileHistory.map((item, idx) => (
                <div className="profile-history-row" key={`${item.at}-${idx}`}>
                  <span>{formatShortTime(item.at)}</span>
                  <strong>{item.action}</strong>
                  <small>{(item.fields || []).join(', ') || item.backupId || ''}</small>
                </div>
              )) : <span className="pf-none">아직 변경 이력 없음</span>}
            </div>
          </section>
        </div>

        <footer className="profile-modal-actions">
          {profile.current ? <span className="chip">현재 기본 프로필</span> : <button className="ghost small" disabled={busy} onClick={() => onSetDefault(profile.name)}>기본 프로필로 설정</button>}
          <button className="ghost small" onClick={onClose}>닫기</button>
        </footer>
      </section>
    </div>
  );
}

function ProfileRow({ p, label, crashed, runtimeState, busy, onToggle, onRestart, onOpenSettings }) {
  const displayName = label?.label || p.name;
  const displayDesc = label?.desc || null;
  const rowClass = ['prow', p.running ? 'is-running' : '', p.current ? 'is-current' : '', crashed ? 'is-crashed' : '', runtimeState?.restartNeeded ? 'needs-restart' : ''].filter(Boolean).join(' ');

  return (
    <div className={rowClass}>
      <span className={`run-dot ${p.running ? 'on' : ''} ${crashed ? 'crash' : ''}`} />
      <span className="cell-name-stack">
        <span className="cell-name">
          {displayName}
          {p.current ? <Star size={13} className="star" /> : null}
          {crashed ? <span className="crash-tag" title="실행 중이던 게이트웨이가 중단됨"><AlertTriangle size={11} /> 중단됨</span> : null}
          {runtimeState?.restartNeeded ? <span className="restart-tag">재시작 필요</span> : null}
        </span>
        {displayDesc ? <span className="cell-desc">{displayDesc}</span> : displayName !== p.name ? <span className="cell-tech-name">{p.name}</span> : null}
      </span>
      <span className="cell-muted profile-summary-cell">
        <span>{p.model || '—'}</span>
        <small>추론 {p.reasoning || '기본값'}</small>
      </span>
      <span className="cell-platforms">
        {p.platforms && p.platforms.length > 0 ? p.platforms.map((pf) => <PlatformBadge key={pf.name} platform={pf} />) : <span className="pf-none">—</span>}
      </span>
      <span className="cell-action">
        {runtimeState?.restartNeeded && p.running ? <button className="gw-toggle restart" disabled={busy} onClick={() => onRestart(p)}>재시작</button> : null}
        {p.running ? <button className="gw-toggle stop" disabled={busy} onClick={() => onToggle(p)} title={`${displayName} 정지`}><Square size={14} /> 정지</button> : <button className="gw-toggle start" disabled={busy} onClick={() => onToggle(p)} title={`${displayName} 시작`}><Play size={14} /> 시작</button>}
        <button className="gw-toggle settings" disabled={busy} onClick={() => onOpenSettings(p)} title={`${displayName} 설정`}><Settings size={14} /> 설정</button>
      </span>
    </div>
  );
}

export default function ProfilesTab({
  t, profiles, labels, opsState = { runtime: {}, history: [], watchdog: null }, modelOptions = [], reasoningOptions = [], crashed, busyName, loading,
  onReload, onToggle, onRestart, onSetDefault, onUpdateModelSettings, onRestoreBackup, onLoadBackups, onLoadLogSummary, onSaveLabel
}) {
  const [onlyRunning, setOnlyRunning] = useState(false);
  const [filter, setFilter] = useState('all');
  const [settingsProfileName, setSettingsProfileName] = useState('');
  const runtime = opsState.runtime || {};

  const rank = (p) => (crashed.has(p.name) ? 0 : runtime[p.name]?.restartNeeded ? 1 : p.running ? 2 : 3);
  const sorted = [...profiles].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    const la = labels[a.name]?.label || a.name;
    const lb = labels[b.name]?.label || b.name;
    return la.localeCompare(lb, 'ko');
  });
  const filtered = sorted.filter((p) => {
    if (onlyRunning && !p.running) return false;
    if (filter === 'running') return p.running;
    if (filter === 'restart') return Boolean(runtime[p.name]?.restartNeeded);
    if (filter === 'codex') return p.provider === 'openai-codex' || /gpt-|codex/i.test(p.model || '');
    if (filter === 'claude') return p.provider === 'anthropic' || /claude/i.test(p.model || '');
    if (filter === 'problems') return crashed.has(p.name) || Boolean(runtime[p.name]?.restartNeeded) || (p.platforms || []).some((pf) => pf.state === 'error');
    return true;
  });
  const runningCount = profiles.filter((p) => p.running).length;
  const restartCount = profiles.filter((p) => runtime[p.name]?.restartNeeded).length;
  const settingsProfile = profiles.find((p) => p.name === settingsProfileName) || null;

  const action = (
    <div className="panel-actions profile-panel-actions">
      <select className="profile-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
        {FILTERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <label className="mini-toggle"><ToggleSwitch checked={onlyRunning} onChange={setOnlyRunning} label="실행 중만" /><span>실행 중만</span></label>
      <button className="ghost small" disabled={loading} onClick={onReload} title="새로고침"><RefreshCw size={15} className={loading ? 'spin' : ''} /> 새로고침</button>
    </div>
  );

  return (
    <>
      <Panel icon={Bot} title={t.tabProfiles} subtitle={`${t.profilesSubtitle}  ·  ${runningCount}/${profiles.length} ${t.running}  ·  재시작 필요 ${restartCount}`} action={action}>
        {filtered.length === 0 && !loading ? <div className="empty">{t.profilesEmpty}</div> : (
          <div className="table profiles-table">
            {filtered.map((p) => <ProfileRow key={p.name} p={p} label={labels[p.name]} crashed={crashed.has(p.name)} runtimeState={runtime[p.name]} busy={busyName === p.name} onToggle={onToggle} onRestart={onRestart} onOpenSettings={(profile) => setSettingsProfileName(profile.name)} />)}
          </div>
        )}
      </Panel>
      <ProfileSettingsModal
        profile={settingsProfile}
        label={settingsProfile ? labels[settingsProfile.name] : null}
        runtimeState={settingsProfile ? runtime[settingsProfile.name] : null}
        opsState={opsState}
        modelOptions={modelOptions}
        reasoningOptions={reasoningOptions}
        busy={Boolean(settingsProfile && busyName === settingsProfile.name)}
        onClose={() => setSettingsProfileName('')}
        onSetDefault={onSetDefault}
        onUpdateModelSettings={onUpdateModelSettings}
        onRestoreBackup={onRestoreBackup}
        onLoadBackups={onLoadBackups}
        onLoadLogSummary={onLoadLogSummary}
        onSaveLabel={onSaveLabel}
        onRestart={onRestart}
      />
    </>
  );
}
