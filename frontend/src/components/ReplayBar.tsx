import { useEffect, useState, useRef } from 'react';
import { API_BASE } from '../lib/config';
import type { ServerMessage } from '../types';

interface ReplayFrame {
  mission_id: string;
  seq: number;
  sim_time: number;
  type: string;
  payload: Record<string, unknown>;
}

interface Props {
  onReplayFrame: (msg: ServerMessage) => void;
  activeMissionId?: string;
}

export default function ReplayBar({ onReplayFrame, activeMissionId = 'MISSION-AEROSAR-01' }: Props) {
  const [missions, setMissions] = useState<string[]>([]);
  const [selectedMission, setSelectedMission] = useState(activeMissionId);
  const [frames, setFrames] = useState<ReplayFrame[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);

  const timerRef = useRef<number | null>(null);

  // Fetch available recorded missions
  useEffect(() => {
    fetch(`${API_BASE}/api/missions`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const ids = data.map((m: { mission_id: string }) => m.mission_id);
          setMissions(ids);
          if (ids.length && !ids.includes(selectedMission)) {
            setSelectedMission(ids[0]);
          }
        }
      })
      .catch(() => {});
  }, [selectedMission]);

  // Load replay frames for selected mission
  const loadReplay = (mId: string) => {
    fetch(`${API_BASE}/api/missions/${mId}/replay`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setFrames(data);
          setCurrentIdx(0);
          setIsPlaying(false);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (selectedMission) {
      loadReplay(selectedMission);
    }
  }, [selectedMission]);

  // Frame emission
  const emitFrame = (idx: number) => {
    if (!frames.length || idx >= frames.length) return;
    const f = frames[idx];
    const serverMsg: ServerMessage = {
      type: f.type as any,
      data: f.payload as any,
    };
    onReplayFrame(serverMsg);
  };

  // Playback timer loop
  useEffect(() => {
    if (!isPlaying) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const intervalMs = Math.max(25, 100 / speed);
    timerRef.current = window.setInterval(() => {
      setCurrentIdx((prev) => {
        const next = prev + 1;
        if (next >= frames.length) {
          setIsPlaying(false);
          return prev;
        }
        emitFrame(next);
        return next;
      });
    }, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, frames, speed]);

  const handleScrub = (idx: number) => {
    setCurrentIdx(idx);
    emitFrame(idx);
  };

  const maxIdx = Math.max(0, frames.length - 1);
  const currentSimTime = frames[currentIdx]?.sim_time ?? 0;

  return (
    <div className="replay-bar" style={{ background: '#161b22', padding: '10px 16px', borderRadius: '8px', marginBottom: '16px', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontWeight: 'bold', fontSize: '13px' }}>⏮ Mission Replay Log</span>
          <select
            value={selectedMission}
            onChange={(e) => setSelectedMission(e.target.value)}
            style={{ background: '#0d1117', color: '#fff', border: '1px solid #30363d', padding: '3px 8px', borderRadius: '4px' }}
          >
            {missions.length ? (
              missions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))
            ) : (
              <option value={activeMissionId}>{activeMissionId}</option>
            )}
          </select>
          <button
            type="button"
            className="link-btn"
            onClick={() => loadReplay(selectedMission)}
            style={{ fontSize: '12px' }}
          >
            Refresh
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="btn-control"
            onClick={() => setIsPlaying(!isPlaying)}
            style={{ minWidth: '70px' }}
          >
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>

          <span style={{ fontSize: '12px' }}>Speed:</span>
          {([1, 2, 4] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`btn-tag ${speed === s ? 'is-active' : ''}`}
              onClick={() => setSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <input
          type="range"
          min={0}
          max={maxIdx}
          value={currentIdx}
          onChange={(e) => handleScrub(Number(e.target.value))}
          style={{ flex: 1, cursor: 'pointer' }}
          disabled={!frames.length}
        />
        <span className="mono" style={{ fontSize: '12px', minWidth: '130px', textAlign: 'right' }}>
          Seq: {frames[currentIdx]?.seq ?? 0} | T: {currentSimTime.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}
