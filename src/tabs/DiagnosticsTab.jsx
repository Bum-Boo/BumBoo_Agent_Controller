import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Cpu, HardDrive, RefreshCw, ShieldAlert } from 'lucide-react';
import { Panel } from '../components.jsx';

export default function DiagnosticsTab({ t }) {
  const [diag, setDiag] = useState(null);
  const [loading, setLoading] = useState(false);
  const [elevating, setElevating] = useState(false);
  const [elevatedNote, setElevatedNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.hermes.getDiagnostics();
      setDiag(result);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const checkElevated = async () => {
    setElevating(true);
    setElevatedNote('');
    try {
      const result = await window.hermes.getRequestsElevated();
      if (result && result.ok) {
        setDiag((prev) => ({ ...prev, requests: { ok: true, accessDenied: false, categories: result.categories, raw: result.raw } }));
      } else {
        setElevatedNote(result && result.cancelled ? t.elevationCancelled : t.elevationFailed);
      }
    } finally {
      setElevating(false);
    }
  };

  const wsl = diag && diag.wslConfig;
  const requests = diag && diag.requests;
  const blockerCategories = requests && requests.categories
    ? Object.entries(requests.categories).filter(([, items]) => items && items.length > 0)
    : [];

  const reloadBtn = (
    <button className="ghost small" disabled={loading} onClick={load}>
      <RefreshCw size={15} /> {t.reload}
    </button>
  );

  return (
    <div className="diag-stack">
      <Panel icon={Cpu} title={t.activePlan} subtitle={t.diagnosticsSubtitle} action={reloadBtn}>
        <div className="kv">
          <span>{t.activePlan}</span>
          <strong>{diag && diag.activePlan ? (diag.activePlan.name || diag.activePlan.guid || '-') : '...'}</strong>
        </div>
        {diag && diag.plans ? (
          <div className="plan-list">
            {diag.plans.map((p) => (
              <div className={`plan-row ${p.active ? 'active' : ''}`} key={p.guid}>
                <span className="dot" />
                <span className="plan-name">{p.name || p.guid}</span>
                {p.active ? <span className="chip">{t.active}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel icon={HardDrive} title={t.wslLimits}>
        {wsl && wsl.exists ? (
          <div className="kv-grid">
            <div className="kv"><span>{t.memory}</span><strong>{wsl.memory || t.notSet}</strong></div>
            <div className="kv"><span>{t.processors}</span><strong>{wsl.processors || t.notSet}</strong></div>
            <div className="kv"><span>{t.swap}</span><strong>{wsl.swap || t.notSet}</strong></div>
          </div>
        ) : (
          <div className="notice">{t.wslConfigMissing}</div>
        )}
      </Panel>

      <Panel icon={Activity} title={t.sleepBlockers}>
        {requests && requests.accessDenied ? (
          <div className="notice warn">
            <ShieldAlert size={16} /> {elevatedNote || t.requiresAdmin}
            <button className="ghost small" disabled={elevating} onClick={checkElevated}>{t.checkRequestsAdmin}</button>
          </div>
        ) : blockerCategories.length === 0 ? (
          <div className="notice">{t.noBlockers}</div>
        ) : (
          <div className="blockers">
            {blockerCategories.map(([cat, items]) => (
              <div className="blocker-cat" key={cat}>
                <div className="blocker-title">{cat}</div>
                {items.map((item, i) => <div className="blocker-item" key={i}>{item}</div>)}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
