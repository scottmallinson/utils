import type { LayoutSettings, MarginId, Orientation, PageSizeId } from '../lib/types';
import { Icon } from './Icon';

const PAGE_SIZE_OPTIONS: { value: PageSizeId; label: string }[] = [
  { value: 'source', label: 'Original size' },
  { value: 'a4', label: 'A4' },
  { value: 'a3', label: 'A3' },
  { value: 'a5', label: 'A5' },
  { value: 'letter', label: 'US Letter' },
  { value: 'legal', label: 'US Legal' },
];

const ORIENTATION_OPTIONS: { value: Orientation; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

const MARGIN_OPTIONS: { value: MarginId; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

interface Props {
  settings: LayoutSettings;
  hasPages: boolean;
  busy: boolean;
  onSettingsChange(settings: Partial<LayoutSettings>): void;
  onAddFiles(): void;
  onRotateAll(degrees: number): void;
  onClear(): void;
  onSave(): void;
}

export function Toolbar({
  settings,
  hasPages,
  busy,
  onSettingsChange,
  onAddFiles,
  onRotateAll,
  onClear,
  onSave,
}: Props) {
  const fixedSize = settings.pageSize !== 'source';
  const fixedSizeHint = fixedSize ? undefined : 'Choose a page size to set orientation and margins';

  return (
    <header className="toolbar">
      <button type="button" className="button" onClick={onAddFiles} disabled={busy}>
        <Icon name="plus" />
        Add files
      </button>

      <div className="toolbar-group">
        <label className="field">
          <span>Page size</span>
          <select
            value={settings.pageSize}
            onChange={(e) => onSettingsChange({ pageSize: e.target.value as PageSizeId })}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="field segmented" disabled={!fixedSize} title={fixedSizeHint}>
          <legend>Orientation</legend>
          <div className="segments">
            {ORIENTATION_OPTIONS.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name="orientation"
                  value={option.value}
                  checked={settings.orientation === option.value}
                  onChange={() => onSettingsChange({ orientation: option.value })}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field" title={fixedSizeHint}>
          <span>Margins</span>
          <select
            value={settings.margin}
            disabled={!fixedSize}
            onChange={(e) => onSettingsChange({ margin: e.target.value as MarginId })}
          >
            {MARGIN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          className="icon-button"
          title="Rotate all pages left"
          aria-label="Rotate all pages left"
          onClick={() => onRotateAll(-90)}
          disabled={!hasPages || busy}
        >
          <Icon name="rotateLeft" />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Rotate all pages right"
          aria-label="Rotate all pages right"
          onClick={() => onRotateAll(90)}
          disabled={!hasPages || busy}
        >
          <Icon name="rotateRight" />
        </button>
        <button
          type="button"
          className="button subtle"
          onClick={onClear}
          disabled={!hasPages || busy}
        >
          Clear
        </button>
      </div>

      <button
        type="button"
        className="button primary"
        onClick={onSave}
        disabled={!hasPages || busy}
      >
        <Icon name="download" />
        Save PDF
      </button>
    </header>
  );
}
