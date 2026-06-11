import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, FileText, Pause, Trash2 } from 'lucide-react';
import { Panel, ToggleSwitch } from '../components.jsx';

const MAX_LINES = 2500;
const ALL_LOGS = '__all__';

function lineTone(line) {
  if (/\b(ERROR|CRITICAL|Traceback|Exception|failed|failure)\b/i.test(line)) return 'err';
  if (/\bWARN(ING)?\b|timeout|retry/i.test(line)) return 'warn';
  if (/\b(INFO)\b/.test(line)) return 'info';
  return '';
}

export default function LogTab({ t }) {
  const [lines, setLines] = useState([]);
  const [follow, setFollow] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef(null);
  const lineKey = useRef(0);

  useEffect(() => {
    const off = window.hermes.onLogLine((payload) => {
      if (!payload || payload.name !== ALL_LOGS) return;
      setLines((prev) => {
        const next = prev.concat({ id: ++lineKey.current, text: payload.line });
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    });
    const offEnd = window.hermes.onLogEnd(() => setStreaming(false));
    setLines([]);
    setStreaming(true);
    window.hermes.logStart(ALL_LOGS);
    return () => {
      off();
      offEnd();
      window.hermes.logStop();
    };
  }, []);

  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, follow]);

  const action = (
    <div className="panel-actions">
      <label className="mini-toggle">
        <ToggleSwitch checked={follow} onChange={setFollow} label="따라가기" />
        <span>따라가기</span>
      </label>
      <button className="ghost small" onClick={() => setLines([])} title="지우기">
        <Trash2 size={15} /> 지우기
      </button>
    </div>
  );

  return (
    <Panel
      icon={FileText}
      title="전체 로그"
      subtitle="모든 프로필 gateway.log / gateway.controller.log 원문 스트림"
      action={action}
    >
      <div className="log-view" ref={scrollRef}>
        {lines.length === 0 ? (
          <div className="log-empty">
            {streaming ? <><Pause size={14} className="spin" /> 전체 로그를 기다리는 중…</> : <>표시할 로그가 없습니다.</>}
          </div>
        ) : (
          lines.map((l) => <div key={l.id} className={`log-line ${lineTone(l.text)}`}>{l.text || ' '}</div>)
        )}
      </div>
      <div className="log-foot">
        <span><ArrowDownToLine size={13} /> {lines.length} 줄{lines.length >= MAX_LINES ? ` (최근 ${MAX_LINES}줄만 유지)` : ''}</span>
      </div>
    </Panel>
  );
}
