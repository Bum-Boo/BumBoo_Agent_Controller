import React from 'react';
import { AlertTriangle, CheckCircle2, Info, RefreshCw, X } from 'lucide-react';

const TOAST_ICON = { ok: CheckCircle2, warn: AlertTriangle, err: AlertTriangle, info: Info, busy: RefreshCw };

// Stacked transient notifications, bottom-right. Driven by App-level state.
export function ToastStack({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((toast) => {
        const Icon = TOAST_ICON[toast.tone] || Info;
        return (
          <div key={toast.id} className={`toast ${toast.tone || 'info'}`} role="status">
            <Icon size={16} className={toast.tone === 'busy' ? 'spin' : ''} />
            <span className="toast-msg">{toast.msg}</span>
            <button className="toast-x" onClick={() => onDismiss(toast.id)} aria-label="dismiss">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function StatusBadge({ status, t }) {
  if (status.ready) return <span className="badge ok">{t.connected}</span>;
  if (status.wslRunning) return <span className="badge warn">{t.partial}</span>;
  return <span className="badge off">{t.stopped}</span>;
}

export function StatCard({ icon: Icon, label, value, tone = 'neutral' }) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="stat-icon"><Icon size={19} /></div>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <nav className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`tab ${active === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.icon ? <tab.icon size={16} /> : null}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function ToggleSwitch({ checked, disabled, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function SettingRow({ title, hint, children }) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <span>{title}</span>
        {hint ? <small>{hint}</small> : null}
      </div>
      {children}
    </div>
  );
}

export function Panel({ icon: Icon, title, subtitle, action, children }) {
  return (
    <section className="panel">
      <div className="panel-head">
        {Icon ? <div className="panel-icon"><Icon size={19} /></div> : null}
        <div className="panel-copy">
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action ? <div className="panel-action">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
