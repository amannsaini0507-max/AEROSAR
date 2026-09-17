import { useEffect, useRef, useState } from 'react';
import type { AlertItem } from '../types';
import { LEVEL_LABEL } from '../lib/levels';
import { formatClock } from '../lib/time';

/** Only the alerts an operator must not miss pop up as toasts; everything else stays in the feed. */
const TOAST_TYPES = new Set(['CRITICAL_PRIORITY', 'LINK_LOST', 'LINK_RESTORED', 'GPS_LOST']);
const TOAST_MS = 7000;
/** Backlog replayed to a late-joining dashboard is history, not news — don't pop it up. */
const MAX_TOAST_AGE_MS = 20_000;

export default function AlertToasts({ alerts }: { alerts: AlertItem[] }) {
  const [visible, setVisible] = useState<AlertItem[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const initialised = useRef(false);

  useEffect(() => {
    const fresh = alerts.filter((a) => !seen.current.has(a.id));
    fresh.forEach((a) => seen.current.add(a.id));
    if (!initialised.current) {
      initialised.current = true;
      if (alerts.length > 0) return; // don't replay history when the page first mounts
    }
    const toToast = fresh.filter((a) => TOAST_TYPES.has(a.alertType) && a.receivedAt - a.time < MAX_TOAST_AGE_MS);
    if (toToast.length === 0) return;
    setVisible((v) => [...toToast, ...v].slice(0, 3));
    toToast.forEach((a) => {
      window.setTimeout(() => setVisible((v) => v.filter((x) => x.id !== a.id)), TOAST_MS);
    });
  }, [alerts]);

  if (visible.length === 0) return null;

  return (
    <div className="alert-stack" aria-live="assertive">
      {visible.map((a) => (
        <div key={a.id} className={`alert-toast level-${a.level.toLowerCase()}`}>
          <span className="alert-toast__bar" />
          <div>
            <div className="alert-toast__title">{a.message}</div>
            <div className="alert-toast__meta">
              {LEVEL_LABEL[a.level]} at {formatClock(a.time)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
