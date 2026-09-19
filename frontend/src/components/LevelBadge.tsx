import type { DisplayLevel } from '../types';
import { LEVEL_LABEL } from '../lib/levels';

export default function LevelBadge({ level, large = false }: { level: DisplayLevel | null; large?: boolean }) {
  const cls = level ? level.toLowerCase() : 'unscored';
  return <span className={`level-badge level-${cls}${large ? ' level-badge--large' : ''}`}>{level ? LEVEL_LABEL[level] : 'Unscored'}</span>;
}
