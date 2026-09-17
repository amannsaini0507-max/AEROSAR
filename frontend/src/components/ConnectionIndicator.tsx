import type { LinkView } from '../lib/derive';

const GLYPH: Record<LinkView['state'], string> = { CONNECTED: '●', OFFLINE: '○', SYNCING: '⟳' };

/** Top-bar link indicator (master doc §14.2 / §14.5). */
export default function ConnectionIndicator({ link, compact = false }: { link: LinkView; compact?: boolean }) {
  return (
    <div className={`link-indicator link-indicator--${link.state.toLowerCase()}`} role="status" aria-live="polite" title={link.detail}>
      <span className="link-indicator__glyph" aria-hidden="true">
        {GLYPH[link.state]}
      </span>
      <span className="link-indicator__text">
        <span className="link-indicator__state">{link.state === 'SYNCING' ? 'SYNCING…' : link.state}</span>
        {!compact && <span className="link-indicator__detail">{link.detail}</span>}
      </span>
    </div>
  );
}
