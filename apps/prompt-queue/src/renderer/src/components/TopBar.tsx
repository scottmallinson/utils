import { PRIMARY_WINDOWS, windowLabel } from '../../../shared/limits';
import type { ToolLimits } from '../../../shared/types';
import { formatTime } from '../lib/format';
import { Icon } from './Icon';

interface Props {
  /** Limits with reset windows already dropped. */
  limits: ToolLimits;
  paused: boolean;
  now: number;
  onTogglePause(): void;
  onResumeTool(): void;
  onSettings(): void;
}

export function TopBar({ limits, paused, now, onTogglePause, onResumeTool, onSettings }: Props) {
  const keys = [
    ...PRIMARY_WINDOWS,
    ...Object.keys(limits.windows).filter(
      (key) => !(PRIMARY_WINDOWS as readonly string[]).includes(key),
    ),
  ];
  return (
    <header className="topbar">
      <section className="limits" aria-label="Claude Code usage limits">
        <span className="tool-name">Claude Code</span>
        {keys.map((key) => {
          const window = limits.windows[key];
          const utilization = window?.utilization;
          const tone =
            window?.status === 'limited'
              ? 'danger'
              : window?.status === 'warning'
                ? 'warning'
                : 'ok';
          const detail =
            window === undefined
              ? 'No reports yet'
              : [
                  utilization !== undefined ? `${Math.round(utilization)}% used` : 'OK',
                  window.resetsAt ? `resets ${formatTime(window.resetsAt, now)}` : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ');
          return (
            <div key={key} className={`meter tone-${tone}`} title={`${windowLabel(key)} limit`}>
              <span className="meter-label">{windowLabel(key)}</span>
              <span className="meter-bar" aria-hidden="true">
                <span style={{ width: `${utilization ?? 0}%` }} />
              </span>
              <span className="meter-detail">{detail}</span>
            </div>
          );
        })}
        {limits.pausedUntil !== undefined && (
          <div className="limit-pause" role="status">
            <Icon name="clock" size={14} />
            <span>
              {limits.pausedReason ?? 'Limit reached'}: waiting until{' '}
              {formatTime(limits.pausedUntil, now)}
            </span>
            <button type="button" className="link-button" onClick={onResumeTool}>
              Try now
            </button>
          </div>
        )}
      </section>

      <div className="topbar-actions">
        <button
          type="button"
          className={`button${paused ? ' primary' : ''}`}
          onClick={onTogglePause}
          aria-pressed={paused}
        >
          <Icon name={paused ? 'play' : 'pause'} />
          {paused ? 'Resume queue' : 'Pause queue'}
        </button>
        <button
          type="button"
          className="icon-button large"
          aria-label="Settings"
          onClick={onSettings}
        >
          <Icon name="settings" size={18} />
        </button>
      </div>
    </header>
  );
}
