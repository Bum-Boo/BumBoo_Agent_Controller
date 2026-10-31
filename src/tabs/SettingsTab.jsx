import React, { useEffect, useRef, useState } from 'react';
import { Archive, Gauge, Languages, LifeBuoy, MemoryStick, MonitorOff, Moon, Power, RotateCcw, Save, Settings, Timer, Zap } from 'lucide-react';
import { Panel, SettingRow, ToggleSwitch } from '../components.jsx';
import { languageOptions } from '../i18n.js';
import LogTab from './LogTab.jsx';

// Slider whose thumb tracks the drag locally and immediately (smooth, snaps to
// `step`), while the backend write is debounced. Persisting on every tick made
// the input go `disabled` mid-drag (settingsBusy) and reset the thumb to the
// stale prop value before the IPC round-trip returned — which felt like it only
// moved ~10 per grab. Local state decouples the visual from the async write.
function DebouncedSlider({ icon: Icon, min, max, step, value, disabled, unit, onCommit }) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef(null);
  const draggingRef = useRef(false);

  // Sync from props only when not actively dragging, so an external update
  // (or the echoed value coming back from the backend) doesn't fight the drag.
  useEffect(() => {
    if (!draggingRef.current) setLocal(value);
  }, [value]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleChange = (next) => {
    draggingRef.current = true;
    setLocal(next);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      draggingRef.current = false;
      onCommit(next);
    }, 250);
  };

  const commitNow = () => {
    clearTimeout(timerRef.current);
    draggingRef.current = false;
    onCommit(local);
  };

  return (
    <div className="slider-wrap">
      <Icon size={15} />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        onChange={(e) => handleChange(Number(e.target.value))}
        onMouseUp={commitNow}
        onKeyUp={commitNow}
        onTouchEnd={commitNow}
      />
      <span className="slider-value">{local}{unit}</span>
    </div>
  );
}


function RuntimeConfigPanel({ onToast }) {
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState({});
  const [detect, setDetect] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const cfg = await window.hermes.getControllerConfig();
    setConfig(cfg);
    setDraft(cfg || {});
  };

  useEffect(() => { reload(); }, []);

  const update = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));

  const autoDetect = async () => {
    setBusy(true);
    try {
      const res = await window.hermes.detectControllerEnvironment();
      setDetect(res);
      const first = (res.candidates || []).find((c) => (c.hermesHomes || []).length) || (res.candidates || [])[0];
      if (first) {
        setDraft((prev) => ({
          ...prev,
          distro: first.distro || prev.distro,
          hermesCommand: first.hermesCommand || prev.hermesCommand || 'hermes',
          hermesHome: (first.hermesHomes || [])[0] || prev.hermesHome,
          labRoot: (first.labRoots || [])[0] || prev.labRoot
        }));
      }
      if (onToast) onToast('WSL/Hermes 후보 탐지 완료', 'info');
    } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true);
    try {
      const res = await window.hermes.testControllerConfig(draft);
      setTestResult(res);
      if (onToast) onToast(res.ok ? 'Hermes 연결 테스트 통과' : 'Hermes 연결 테스트 실패', res.ok ? 'ok' : 'err', 7000);
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      const res = await window.hermes.updateControllerConfig(draft);
      setConfig(res.config);
      setDraft(res.config || draft);
      if (onToast) onToast(res.ok === false ? res.error : 'Hermes 연결 설정 저장 완료', res.ok === false ? 'err' : 'ok', res.ok === false ? 9000 : 4500);
    } finally { setBusy(false); }
  };

  const candidates = detect?.candidates || [];

  return (
    <Panel icon={Settings} title="Hermes 연결 설정" subtitle={config?.configured ? `${config.distro} · ${config.hermesHome || 'Hermes Home 미지정'}` : '처음 실행 시 WSL 배포판과 Hermes 디렉토리를 등록하세요.'}>
      <div className="settings-grid controller-config-grid">
        <label className="setting-row">
          <div className="setting-copy"><span>WSL 배포판</span><small>wsl.exe -l -q에서 보이는 이름</small></div>
          <input className="label-input" value={draft.distro || ''} disabled={busy} placeholder="Ubuntu" onChange={(e) => update('distro', e.target.value)} />
        </label>
        <label className="setting-row">
          <div className="setting-copy"><span>Hermes 명령</span><small>PATH에 있으면 hermes 그대로 두면 됩니다.</small></div>
          <input className="label-input" value={draft.hermesCommand || ''} disabled={busy} placeholder="hermes" onChange={(e) => update('hermesCommand', e.target.value)} />
        </label>
        <label className="setting-row">
          <div className="setting-copy"><span>Hermes Home</span><small>profiles/config/logs가 있는 디렉토리</small></div>
          <input className="label-input" value={draft.hermesHome || ''} disabled={busy} placeholder="/home/user/.hermes" onChange={(e) => update('hermesHome', e.target.value)} />
        </label>
        <label className="setting-row">
          <div className="setting-copy"><span>Lab Root</span><small>Hermes 명령을 실행할 작업 루트</small></div>
          <input className="label-input" value={draft.labRoot || ''} disabled={busy} placeholder="/home/user/hermes-lab" onChange={(e) => update('labRoot', e.target.value)} />
        </label>
        <label className="setting-row">
          <div className="setting-copy"><span>Dashboard URL</span><small>대시보드 열기 버튼에 사용</small></div>
          <input className="label-input" value={draft.dashboardUrl || ''} disabled={busy} placeholder="http://127.0.0.1:9119" onChange={(e) => update('dashboardUrl', e.target.value)} />
        </label>
      </div>
      {candidates.length ? (
        <div className="controller-candidates">
          {candidates.map((c) => <button key={c.distro} className="ghost small" disabled={busy} onClick={() => setDraft((prev) => ({ ...prev, distro: c.distro, hermesCommand: c.hermesCommand || prev.hermesCommand, hermesHome: (c.hermesHomes || [])[0] || prev.hermesHome, labRoot: (c.labRoots || [])[0] || prev.labRoot }))}>{c.distro} 후보 적용</button>)}
        </div>
      ) : null}
      {testResult ? (
        <div className={`controller-test-result ${testResult.ok ? 'ok' : 'err'}`}>
          {(testResult.checks || []).map((check) => <div key={check.name}><strong>{check.ok ? '통과' : '실패'}</strong> {check.name} <small>{check.detail}</small></div>)}
        </div>
      ) : null}
      <div className="wsl-mem-actions">
        <div className="wsl-mem-note">저장값은 사용자 앱 데이터에만 보관되고 GitHub에 올라가지 않습니다.</div>
        <button className="ghost small" disabled={busy} onClick={autoDetect}>자동 탐지</button>
        <button className="ghost small" disabled={busy} onClick={test}>연결 테스트</button>
        <button className="gw-toggle start" disabled={busy} onClick={save}><Save size={15} /> 저장</button>
      </div>
    </Panel>
  );
}

// Backup / restore of the controller's own settings (app settings, Hermes
// connection settings, profile display names). A restore that fails part-way
// is rolled back to the settings in place before it started.
function SettingsBackupPanel({ onToast, onRestored }) {
  const [backups, setBackups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const reload = async () => {
    const list = await window.hermes.listSettingsBackups();
    setBackups(Array.isArray(list) ? list : []);
  };

  useEffect(() => { reload(); }, []);

  const create = async () => {
    setBusy(true);
    try {
      const res = await window.hermes.createSettingsBackup();
      setResult(res && res.ok ? { ok: true, msg: `백업 생성: ${res.id}` } : { ok: false, msg: `백업 실패: ${(res && res.error) || '알 수 없는 오류'}` });
      await reload();
    } finally { setBusy(false); }
  };

  const restore = async (id) => {
    if (!window.confirm(`설정을 ${id} 백업으로 되돌릴까요?\n지금 설정은 pre-restore 백업으로 먼저 저장됩니다.`)) return;
    setBusy(true);
    try {
      const res = await window.hermes.restoreSettingsBackup(id);
      if (res && res.ok) {
        setResult({ ok: true, msg: `${id} 복원 완료 (되돌리기: ${res.preRestoreId || '없음'})` });
        if (onToast) onToast('설정 복원 완료', 'ok');
        if (onRestored) onRestored(res);
      } else {
        const msg = `복원 실패: ${(res && res.error) || '알 수 없는 오류'}${res && res.rolledBack ? ' · 이전 설정으로 복구됨' : ''}`;
        setResult({ ok: false, msg });
        if (onToast) onToast(msg, 'err', 9000);
      }
      await reload();
    } finally { setBusy(false); }
  };

  return (
    <Panel icon={Archive} title="설정 백업 / 복원" subtitle="앱 설정 · Hermes 연결 설정 · 프로필 표시 이름을 사용자 앱 데이터에 백업합니다.">
      <div className="wsl-mem-actions">
        <div className="wsl-mem-note">복원 중 오류가 나면 복원 직전 설정으로 자동 복구됩니다.</div>
        <button className="gw-toggle start" disabled={busy} onClick={create}><Archive size={15} /> 지금 백업</button>
      </div>
      <div className="settings-backup-list">
        {backups.length ? backups.slice(0, 10).map((b) => (
          <div className={`settings-backup-row ${b.valid ? '' : 'invalid'}`} key={b.id} data-backup-id={b.id}>
            <span>{b.id} <small>{b.valid ? b.reason : '손상됨'}</small></span>
            <button className="ghost small" disabled={busy || !b.valid} onClick={() => restore(b.id)}><RotateCcw size={12} /> 복원</button>
          </div>
        )) : <span className="pf-none">아직 백업 없음</span>}
      </div>
      {result ? <div className={`settings-backup-result ${result.ok ? 'ok' : 'err'}`}>{result.msg}</div> : null}
    </Panel>
  );
}

// WSL RAM allocation editor. Writes %USERPROFILE%\.wslconfig ([wsl2] memory=NGB).
// Changes need a `wsl --shutdown` to take effect — offered as a separate
// "지금 적용" button so saving and restarting are distinct choices.
function WslMemoryPanel({ onToast }) {
  const [info, setInfo] = useState(null); // { totalGb, currentGb, raw, exists }
  const [limit, setLimit] = useState(true); // false => auto (no memory= line)
  const [gb, setGb] = useState(8);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const res = await window.hermes.getWslMemory();
    setInfo(res);
    if (res.currentGb && res.currentGb > 0) {
      setLimit(true);
      setGb(res.currentGb);
    } else {
      setLimit(false);
      setGb(Math.max(2, Math.round((res.totalGb || 16) / 2)));
    }
  };

  useEffect(() => { reload(); }, []);

  const maxGb = info ? Math.max(4, info.totalGb - 2) : 32; // leave headroom for Windows

  const save = async (applyNow) => {
    if (applyNow && !window.confirm('WSL을 지금 재시작해서 새 메모리 설정을 적용할까요?\n실행 중인 게이트웨이가 잠시 중지됩니다.')) return;
    setBusy(true);
    try {
      const value = limit ? gb : 0; // 0 => clear the limit (WSL auto-default)
      const res = await window.hermes.setWslMemory(value, applyNow);
      if (onToast) {
        if (res && res.restarted) onToast(limit ? `WSL 메모리 ${gb}GB 적용 완료` : 'WSL 메모리 제한 해제 (적용됨)', 'ok');
        else onToast(limit ? `WSL 메모리 ${gb}GB 저장됨 · WSL 재시작 후 적용` : 'WSL 메모리 제한 해제 저장됨', 'info', 6000);
      }
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      icon={MemoryStick}
      title="WSL 메모리 할당"
      subtitle={info ? `이 PC 총 RAM ${info.totalGb}GB · 현재 설정 ${info.raw || '자동(기본 50%)'}` : 'WSL에 할당할 최대 메모리'}
    >
      <div className="settings-grid">
        <SettingRow title="메모리 직접 제한" hint="끄면 WSL이 자동으로 관리합니다(기본: 전체 RAM의 50%).">
          <ToggleSwitch checked={limit} disabled={busy} label="메모리 직접 제한" onChange={setLimit} />
        </SettingRow>

        <SettingRow title="할당할 최대 메모리" hint={`2GB ~ ${maxGb}GB (Windows용 여유를 남깁니다).`}>
          <DebouncedSlider
            icon={MemoryStick}
            min={2}
            max={maxGb}
            step={1}
            value={gb}
            disabled={busy || !limit}
            unit="GB"
            onCommit={setGb}
          />
        </SettingRow>
      </div>

      <div className="wsl-mem-actions">
        <div className="wsl-mem-note">
          변경 사항은 <strong>WSL 재시작</strong> 후에 적용됩니다.
        </div>
        <button className="ghost small" disabled={busy} onClick={() => save(false)}>
          <Save size={15} /> 저장
        </button>
        <button className="gw-toggle start" disabled={busy} onClick={() => save(true)}>
          <Zap size={15} /> 저장하고 지금 적용
        </button>
      </div>
    </Panel>
  );
}

export default function SettingsTab({ settings, settingsBusy, t, onUpdate, onToast, onSettingsRestored }) {
  // Remount the connection panel after a restore so it re-reads the config.
  const [restoreCount, setRestoreCount] = useState(0);
  return (
    <div className="settings-stack">
      <RuntimeConfigPanel key={restoreCount} onToast={onToast} />

      <SettingsBackupPanel onToast={onToast} onRestored={() => { setRestoreCount((n) => n + 1); if (onSettingsRestored) onSettingsRestored(); }} />

      <Panel icon={Power} title={t.powerSettings} subtitle={t.powerSettingsSubtitle}>
        <div className="settings-grid">
          <SettingRow title={t.autoServerMode} hint={t.autoServerModeHint}>
            <ToggleSwitch
              checked={settings.autoServerEnabled}
              disabled={settingsBusy}
              label={t.autoServerMode}
              onChange={(v) => onUpdate({ autoServerEnabled: v })}
            />
          </SettingRow>

          <SettingRow title={t.displayOff} hint={t.displayOffHint}>
            <ToggleSwitch
              checked={settings.turnOffDisplayOnServer}
              disabled={settingsBusy}
              label={t.displayOff}
              onChange={(v) => onUpdate({ turnOffDisplayOnServer: v })}
            />
          </SettingRow>

          <SettingRow title={t.idleThreshold} hint={t.idleThresholdHint}>
            <DebouncedSlider
              icon={Timer}
              min={1}
              max={120}
              step={1}
              value={settings.idleThresholdMinutes}
              disabled={!settings.autoServerEnabled}
              unit={t.minutesUnit}
              onCommit={(v) => onUpdate({ idleThresholdMinutes: v })}
            />
          </SettingRow>

          <SettingRow title={t.cpuCapLabel} hint={t.cpuCapHint}>
            <DebouncedSlider
              icon={Gauge}
              min={20}
              max={100}
              step={5}
              value={settings.serverCpuMax}
              unit={t.percentUnit}
              onCommit={(v) => onUpdate({ serverCpuMax: v })}
            />
          </SettingRow>
        </div>
      </Panel>

      <Panel icon={LifeBuoy} title="게이트웨이 자동 복구" subtitle="크래시 감지는 항상 켜져 있고, 자동 재시작만 선택입니다.">
        <div className="settings-grid">
          <SettingRow title="크래시 시 자동 재시작" hint="실행 중이던 게이트웨이가 멈추면 자동으로 다시 시작합니다. (Hermes 자체 복구와 겹칠 수 있어 기본 꺼짐)">
            <ToggleSwitch
              checked={settings.autoRestartEnabled}
              disabled={settingsBusy}
              label="자동 재시작"
              onChange={(v) => onUpdate({ autoRestartEnabled: v })}
            />
          </SettingRow>

          <SettingRow title="최대 재시도 횟수" hint="10분 안에 이 횟수만큼 재시도한 뒤 멈춥니다. 무한 루프 방지.">
            <DebouncedSlider
              icon={RotateCcw}
              min={1}
              max={10}
              step={1}
              value={settings.autoRestartMax}
              disabled={!settings.autoRestartEnabled}
              unit="회"
              onCommit={(v) => onUpdate({ autoRestartMax: v })}
            />
          </SettingRow>
        </div>
      </Panel>

      <WslMemoryPanel onToast={onToast} />

      <LogTab t={t} />

      <Panel icon={Settings} title={t.settings} subtitle={t.settingsSubtitle}>
        <div className="settings-grid">
          <SettingRow title={t.launchOnStartup} hint={t.launchOnStartupHint}>
            <ToggleSwitch
              checked={settings.startupEnabled}
              disabled={settingsBusy}
              label={t.launchOnStartup}
              onChange={(v) => onUpdate({ startupEnabled: v })}
            />
          </SettingRow>

          <label className="setting-row" htmlFor="language-select">
            <div className="setting-copy">
              <span>{t.language}</span>
              <small>{t.languageHint}</small>
            </div>
            <div className="select-wrap">
              <Languages size={17} />
              <select
                id="language-select"
                value={settings.language}
                disabled={settingsBusy}
                onChange={(event) => onUpdate({ language: event.target.value })}
              >
                {languageOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </label>
        </div>
      </Panel>
    </div>
  );
}
