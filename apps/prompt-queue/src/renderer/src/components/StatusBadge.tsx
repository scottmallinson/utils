import type { StatusDisplay } from '../lib/view';
import { Icon } from './Icon';

export function StatusBadge({ display, compact }: { display: StatusDisplay; compact?: boolean }) {
  return (
    <span
      className={`status-badge tone-${display.tone}${compact ? ' compact' : ''}`}
      title={compact ? display.label : undefined}
    >
      <Icon name={display.icon} size={compact ? 14 : 13} />
      {compact ? <span className="visually-hidden">{display.label}</span> : display.label}
    </span>
  );
}
