import { DEFAULT_MODEL_LABEL, modelGroups } from '../lib/labels';

interface Props {
  value: string;
  id?: string;
  onChange(model: string): void;
}

export function ModelSelect({ value, id, onChange }: Props) {
  return (
    <select
      id={id}
      aria-label="Model"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{DEFAULT_MODEL_LABEL}</option>
      {modelGroups(value).map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
