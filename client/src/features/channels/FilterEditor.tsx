import { useEffect, useId, useRef, useState } from 'react';
import {
  compileSimpleCondition,
  readSimpleCondition,
  type SimpleConditionConfig,
} from '../../../../server/src/utils/simpleCondition';

type FilterMode = 'accept' | 'reject' | 'simple' | 'custom';
interface Props {
  kind: 'source' | 'destination';
  value: string;
  onChange: (script: string) => void;
  onValidityChange?: (valid: boolean) => void;
}
const emptyCondition = (): SimpleConditionConfig => ({
  version: 1,
  field: '',
  operator: 'eq',
  value: '',
});
function modeFor(script: string): FilterMode {
  if (!script.trim() || /^return\s+true\s*;?$/.test(script.trim())) return 'accept';
  if (/^return\s+false\s*;?$/.test(script.trim())) return 'reject';
  return readSimpleCondition(script) ? 'simple' : 'custom';
}

export function FilterEditor({ kind, value, onChange, onValidityChange }: Props) {
  const label = kind === 'source' ? 'Source filter' : 'Destination filter';
  const labelId = useId();
  const errorId = `${labelId}-condition-error`;
  const [mode, setMode] = useState<FilterMode>(() => modeFor(value));
  const [condition, setCondition] = useState<SimpleConditionConfig>(
    () => readSimpleCondition(value) || emptyCondition(),
  );
  const [conditionError, setConditionError] = useState('');
  const [customScript, setCustomScript] = useState(() =>
    modeFor(value) === 'custom' ? value : '',
  );
  const [expanded, setExpanded] = useState(false);
  const lastValue = useRef(value);
  const validityCallback = useRef(onValidityChange);
  validityCallback.current = onValidityChange;

  useEffect(() => {
    if (lastValue.current === value) return;
    lastValue.current = value;
    const nextMode = modeFor(value);
    setMode(nextMode);
    const parsed = readSimpleCondition(value);
    if (parsed) setCondition(parsed);
    if (nextMode === 'custom') setCustomScript(value);
    setConditionError('');
    validityCallback.current?.(true);
    setExpanded(false);
  }, [value]);

  function update(script: string) {
    lastValue.current = script;
    onChange(script);
  }
  function updateCondition(nextCondition: SimpleConditionConfig) {
    setCondition(nextCondition);
    try {
      const script = compileSimpleCondition(nextCondition);
      setConditionError('');
      validityCallback.current?.(true);
      update(script);
    } catch {
      setConditionError('Enter a field and a valid value for this condition.');
      validityCallback.current?.(false);
    }
  }
  function choose(nextMode: FilterMode) {
    if (mode === 'custom') setCustomScript(value);
    setMode(nextMode);
    setExpanded(nextMode === 'custom');
    if (nextMode === 'simple') {
      updateCondition(condition);
      return;
    }
    setConditionError('');
    validityCallback.current?.(true);
    update(nextMode === 'custom' ? customScript : `return ${nextMode === 'accept'};`);
  }
  const presenceCondition = condition.operator === 'exists' || condition.operator === 'notExists';
  const numericCondition = ['gt', 'gte', 'lt', 'lte'].includes(condition.operator);

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
          <option value="simple">Simple condition</option>
          <option value="custom">Custom condition (advanced)</option>
          <option value="reject">
            {kind === 'source' ? 'Filter all messages' : 'Skip this destination'}
          </option>
        </select>
      </label>
      {mode === 'simple' && (
        <fieldset className="form-section" aria-label={`${label} simple condition`}>
          <legend>
            {kind === 'source'
              ? 'Process only matching valid messages'
              : 'Send only matching messages'}
          </legend>
          <div className="form-grid">
            <label className="field">
              <span>Field</span>
              <input
                maxLength={256}
                value={condition.field}
                placeholder="message_type"
                spellCheck={false}
                aria-invalid={!!conditionError}
                aria-describedby={conditionError ? errorId : undefined}
                onChange={(event) => updateCondition({ ...condition, field: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Operator</span>
              <select
                aria-label="Operator"
                value={condition.operator}
                onChange={(event) =>
                  updateCondition({
                    ...condition,
                    operator: event.target.value as SimpleConditionConfig['operator'],
                  })
                }
              >
                <option value="eq">Equals</option>
                <option value="neq">Does not equal</option>
                <option value="contains">Contains</option>
                <option value="startsWith">Starts with</option>
                <option value="exists">Exists</option>
                <option value="notExists">Does not exist</option>
                <option value="gt">Greater than</option>
                <option value="gte">Greater than or equal</option>
                <option value="lt">Less than</option>
                <option value="lte">Less than or equal</option>
              </select>
            </label>
          </div>
          {!presenceCondition && (
            <label className="field">
              <span>Value</span>
              <input
                type={numericCondition ? 'number' : 'text'}
                maxLength={1024}
                step={numericCondition ? 'any' : undefined}
                value={condition.value ?? ''}
                aria-invalid={!!conditionError}
                aria-describedby={conditionError ? errorId : undefined}
                onChange={(event) => updateCondition({ ...condition, value: event.target.value })}
              />
            </label>
          )}
          {conditionError && (
            <p id={errorId} className="alert error" role="alert">
              {conditionError}
            </p>
          )}
        </fieldset>
      )}
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
