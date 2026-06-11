import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Bell, Bot, Clock, Cpu, ExternalLink, FolderOpen, Gauge,
  History, MonitorOff, Moon, Power, PowerOff, RadioTower, RefreshCw, Send, Server, ShieldCheck,
  Sun, Wifi, WifiOff, Zap
} from 'lucide-react';
import { StatCard, StatusBadge } from '../components.jsx';
import { serviceLabel, formatDuration, formatTime } from '../i18n.js';

function liveIdleSeconds(mode) {
  if (!mode) return 0;
  const base = Number(mode.idleSeconds) || 0;
  const elapsed = mode.lastTickAt ? (Date.now() - mode.lastTickAt) / 1000 : 0;
  return base + Math.max(0, elapsed);
}

function ModeCard({ mode, t, busy, onEnter, onExit }) {
  const [, forceTick] = useState(0);
  // Local 1s ticker so the idle countdown feels live between backend polls.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => (n + 1) % 1000000), 1000);
    return () => clearInterval(id);
  }, []);

  if (!mode) return null;

  const inServer = mode.mode === 'server';
  const transitioning = mode.transitioning;
  const idle = liveIdleSeconds(mode);
  const remaining = Math.max(0, (mode.thresholdSeconds || 1200) - idle);

  const toneClass = transitioning
    ? 'switching'
    : inServer
      ? (mode.trigger === 'manual' ? 'server-manual' : 'server-auto')
      : 'user';

  const title = transitioning
    ? t.switching
    : inServer
      ? (mode.trigger === 'manual' ? t.serverModeManual : t.serverModeAuto)
      : t.userMode;

  const desc = inServer
    ? (mode.trigger === 'manual' ? t.modeManualDesc : t.modeAutoDesc)
    : t.modeUserDesc;

  const ModeIcon = inServer ? Moon : Sun;

  return (
    <section className={`mode-card ${toneClass}`}>
      <div className="mode-head">
        <div className="mode-id">
          <div className="mode-icon"><ModeIcon size={22} /></div>
          <div>
            <div className="mode-title">{title}</div>
            <div className="mode-desc">{desc}</div>
          </div>
        </div>
        {inServer ? (
          <button className="primary" disabled={busy || transitioning} onClick={onExit}>
            <Sun size={18} /> {t.exitServerMode}
          </button>
        ) : (
          <button className="server-btn" disabled={busy || transitioning} onClick={onEnter}>
            <Moon size={18} /> {t.enterServerMode}
          </button>
        )}
      </div>

      <div className="mode-meta">
        <div className="meta-chip">
          <Gauge size={15} />
          <span>{t.cpuCap}</span>
          <strong>≤ {mode.serverCpuMax}%</strong>
        </div>
        <div className="meta-chip">
          <Cpu size={15} />
          <span>{t.powerPlan}</span>
          <strong title={mode.planName || '-'}>{mode.planName || '-'}</strong>
        </div>
        {mode.blocking ? (
          <div className="meta-chip ok">
            <Zap size={15} />
            <span>{t.suspendBlocked}</span>
          </div>
        ) : null}
        <div className="meta-chip">
          <Clock size={15} />
          <span>{t.idleFor}</span>
          <strong>{formatDuration(idle)}</strong>
        </div>
        {!inServer ? (
          mode.autoServerEnabled ? (
            <div className="meta-chip accent">
              <Moon size={15} />
              <span>{t.autoSwitchIn}</span>
              <strong>{formatDuration(remaining)}</strong>
            </div>
          ) : (
            <div className="meta-chip muted">
              <MonitorOff size={15} />
              <span>{t.autoSwitchOff}</span>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}

function HistoryList({ history, t }) {
  if (!history || history.length === 0) {
    return (
      <section className="panel">
        <div className="panel-head">
          <div className="panel-icon"><History size={19} /></div>
          <div className="panel-copy"><h2>{t.modeHistory}</h2></div>
        </div>
        <div className="empty">{t.historyEmpty}</div>
      </section>
    );
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <div className="panel-icon"><History size={19} /></div>
        <div className="panel-copy"><h2>{t.modeHistory}</h2></div>
      </div>
      <ul className="history">
        {history.slice(0, 8).map((h, i) => {
          const enter = h.event === 'enter';
          const label = enter
            ? `${t.serverMode} · ${h.trigger === 'manual' ? '수동/manual' : 'auto'}`
            : `${t.userMode} · ${h.reason === 'input-detected' ? t.exitServerMode : h.reason || ''}`;
          return (
            <li key={i} className={enter ? 'enter' : 'exit'}>
              <span className="dot" />
              <span className="h-label">{label}</span>
              <span className="h-time">{formatTime(h.at)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function StatusTab({ status, mode, history, summary, t, busy, messageKey, onAction, onRefresh, onShutdownWsl, onEnterServer, onExitServer }) {
  const heroClass = useMemo(() => {
    if (status.ready) return 'hero ready';
    if (status.wslRunning) return 'hero partial';
    return 'hero stopped';
  }, [status]);

  const stateTitle = status.ready ? t.connected : status.wslRunning ? t.partial : t.stopped;

  return (
    <>
      <section className={heroClass}>
        <div className="hero-top">
          <div className="brand">
            <div className="brand-mark"><Bot size={26} /></div>
            <div>
              <h1>{t.appName}</h1>
              <p>{t.subtitle}</p>
            </div>
          </div>
          <StatusBadge status={status} t={t} />
        </div>

        <div className="hero-body">
          <div>
            <div className="state-title">{stateTitle}</div>
            <div className="state-message">{t[messageKey]}</div>
          </div>
          <div className="pulse-wrap">
            <div className="pulse-ring" />
            <div className="pulse-core">{status.ready ? <Wifi size={30} /> : <WifiOff size={30} />}</div>
          </div>
        </div>
      </section>

      <ModeCard mode={mode} t={t} busy={busy} onEnter={onEnterServer} onExit={onExitServer} />

      <section className="grid">
        <StatCard
          icon={RadioTower}
          label="실행 중 게이트웨이"
          value={summary ? `${summary.running} / ${summary.total}` : '…'}
          tone={summary && summary.running > 0 ? 'ok' : 'off'}
        />
        <StatCard
          icon={Send}
          label="연결된 플랫폼"
          value={summary ? `${summary.connected}` : '…'}
          tone={summary && summary.connected > 0 ? 'ok' : 'neutral'}
        />
        <StatCard
          icon={AlertTriangle}
          label="중단 감지"
          value={summary ? `${summary.crashed}` : '…'}
          tone={summary && summary.crashed > 0 ? 'warn' : 'neutral'}
        />
        <StatCard icon={Server} label={t.wslUbuntu} value={status.wslRunning ? t.running : t.stopped} tone={status.wslRunning ? 'ok' : 'off'} />
      </section>

      <section className="grid sub-grid">
        <StatCard icon={Activity} label={t.dashboard} value={status.dashboardOnline ? t.online : t.offline} tone={status.dashboardOnline ? 'ok' : 'off'} />
        <StatCard icon={Bell} label={t.gateway} value={serviceLabel(status.gateway, t)} tone={status.gateway === 'active' ? 'ok' : 'neutral'} />
        <StatCard icon={ShieldCheck} label={t.codexOAuth} value={serviceLabel(status.codexAuth, t)} tone={status.codexAuth === 'logged in' ? 'ok' : 'warn'} />
      </section>

      <section className="actions">
        {status.wslRunning ? (
          <button className="danger" disabled={busy} onClick={() => onAction('stop')}>
            <Power size={18} /> {t.stop}
          </button>
        ) : (
          <button className="primary" disabled={busy} onClick={() => onAction('start')}>
            <Power size={18} /> {t.start}
          </button>
        )}
        <button className="danger-hard" disabled={busy || !status.wslRunning} onClick={onShutdownWsl} title="WSL2 백엔드 VM 전체를 종료하고 메모리를 해제합니다">
          <PowerOff size={18} /> WSL 종료
        </button>
        <button className="ghost" disabled={busy || !status.dashboardOnline} onClick={() => window.hermes.openDashboard()}>
          <ExternalLink size={18} /> {t.dashboard}
        </button>
        <button className="ghost" disabled={busy} onClick={() => window.hermes.openLabFolder()}>
          <FolderOpen size={18} /> {t.labFolder}
        </button>
        <button className="icon-button" disabled={busy} onClick={onRefresh} title={t.refresh} aria-label={t.refresh}>
          <RefreshCw size={18} />
        </button>
      </section>

      <HistoryList history={history} t={t} />
    </>
  );
}
