import { useEffect, useId, useRef, useState } from 'react';

type FilterMode = 'accept' | 'reject' | 'custom';
interface Props {
  kind: 'source' | 'destination';
  value: string;
  onChange: (script: string) => void;
}

function modeFor(script: string): FilterMode {
  if (!script.trim() || /^return\s+true\s*;?$/.test(script.trim())) return 'accept';
  if (/^return\s+false\s*;?$/.test(script.trim())) return 'reject';
  return 'custom';
}

export function FilterEditor({ kind, value, onChange }: Props) {
  const label = kind === 'source' ? 'Source filter' : 'Destination filter';
  const labelId = useId();
  const [mode, setMode] = useState<FilterMode>(() => modeFor(value));
  const [customScript, setCustomScript] = useState(() =>
    modeFor(value) === 'custom' ? value : '',
  );
  const [expanded, setExpanded] = useState(false);
  const lastValue = useRef(value);

  useEffect(() => {
    if (lastValue.current === value) return;
    lastValue.current = value;
    const nextMode = modeFor(value);
    setMode(nextMode);
    if (nextMode === 'custom') setCustomScript(value);
    setExpanded(false);
  }, [value]);

  function update(script: string) {
    lastValue.current = script;
    onChange(script);
  }
  function choose(nextMode: FilterMode) {
    if (mode === 'custom') setCustomScript(value);
    setMode(nextMode);
    setExpanded(nextMode === 'custom');
    update(nextMode === 'custom' ? customScript : `return ${nextMode === 'accept'};`);
  }

  return (
    <div className="form-section">
      <label className="field">
        <span id={labelId}>{label}</span>
        <select
          aria-labelledby={labelId}
          value={mode}
          onChange={(event) => choose(event.target.value as FilterMode)}
        >
          <option value="accept">
            {kind === 'source' ? 'Accept all messages' : 'Deliver to this destination'}
          </option>
          <option value="reject">
            {kind === 'source' ? 'Filter all messages' : 'Skip this destination'}
          </option>
          <option value="custom">Custom condition (advanced)</option>
        </select>
      </label>
      {mode === 'custom' && (
        <details
          className="advanced-section"
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary>Advanced {kind} filter script</summary>
          <label className="field">
            <span>{label} script</span>
            <small>
              {kind === 'source'
                ? 'Return true to accept a message, or false to filter it.'
                : 'Return true to deliver a message, or false to skip this destination.'}
            </small>
            <textarea
              aria-label={`${label} script`}
              rows={4}
              className="code-input"
              value={value}
              onChange={(event) => {
                setCustomScript(event.target.value);
                update(event.target.value);
              }}
            />
          </label>
        </details>
      )}
    </div>
  );
}
