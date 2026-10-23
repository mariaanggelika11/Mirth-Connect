import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { ScriptEditorModal } from '../../components/status/ScriptEditorModal';
import { FieldPicker, type FieldOption } from '../../components/ui/FieldPicker';
import {
  compileSimpleCondition,
  readSimpleCondition,
  type SimpleConditionConfig,
} from '../../../../server/src/utils/simpleCondition';

type FilterMode = 'simple' | 'legacy';
interface Props {
  kind: 'source' | 'destination';
  value: string;
  onChange: (script: string) => void;
  onValidityChange?: (valid: boolean) => void;
  sourceFields?: FieldOption[];
  allowAdvanced?: boolean;
}
const emptyCondition = (): SimpleConditionConfig => ({
  version: 1,
  field: '',
  operator: 'eq',
  value: '',
});
function modeFor(script: string): FilterMode {
  return !script.trim() || readSimpleCondition(script) ? 'simple' : 'legacy';
}

export function FilterEditor({
  kind,
  value,
  onChange,
  onValidityChange,
  sourceFields = [],
  allowAdvanced = false,
}: Props) {
  const label = kind === 'source' ? 'Source filter' : 'Destination filter';
  const labelId = useId();
  const errorId = `${labelId}-condition-error`;
  const [mode, setMode] = useState<FilterMode>(() => modeFor(value));
  const [condition, setCondition] = useState<SimpleConditionConfig>(
    () => readSimpleCondition(value) || emptyCondition(),
  );
  const [conditionError, setConditionError] = useState('');
  const [showConditionError, setShowConditionError] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedError, setAdvancedError] = useState('');
  const [retainedEmptyComparison, setRetainedEmptyComparison] = useState(
    () => kind === 'destination' && readSimpleCondition(value)?.value === '',
  );
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
    setRetainedEmptyComparison(kind === 'destination' && parsed?.value === '');
    setConditionError('');
    validityCallback.current?.(!!value.trim());
    setShowConditionError(false);
  }, [value]);

  useEffect(() => {
    if (!value.trim()) validityCallback.current?.(false);
  }, [kind, value]);

  function update(script: string) {
    lastValue.current = script;
    onChange(script);
  }
  function updateCondition(nextCondition: SimpleConditionConfig) {
    setCondition(nextCondition);
    setRetainedEmptyComparison(false);
    try {
      if (
        kind === 'destination' &&
        !['exists', 'notExists', 'isEmpty', 'isNotEmpty'].includes(nextCondition.operator) &&
        nextCondition.value === ''
      )
        throw new Error('Enter a value for this destination filter condition.');
      const script = compileSimpleCondition(nextCondition);
      setConditionError('');
      validityCallback.current?.(true);
      update(script);
    } catch {
      setConditionError('Enter a field and a valid value for this condition.');
      validityCallback.current?.(false);
    }
  }
  function replaceLegacy() {
    setMode('simple');
    setShowConditionError(false);
    updateCondition(condition);
  }
  const presenceCondition = ['exists', 'notExists', 'isEmpty', 'isNotEmpty'].includes(
    condition.operator,
  );
  const numericCondition = ['gt', 'gte', 'lt', 'lte'].includes(condition.operator);

  return (
    <div className="form-section">
      {mode === 'legacy' && (
        <div className="form-section">
          <p role="status">
            Legacy {kind} filter retained. Its existing behavior remains active until you disable it
            or replace it with a simple condition.
          </p>
          <Button type="button" variant="secondary" onClick={replaceLegacy}>
            Replace with simple condition
          </Button>
        </div>
      )}
      {mode === 'simple' &&
        (kind === 'source' ? (
          <details className="validation-help">
            <summary>Field path help</summary>
            <p className="muted">
              Use a field from the incoming message. JSON: patient.id; XML: Patient.ID; HL7: MSH.9.
              Nested paths use dots; array indexes start at 0.
            </p>
          </details>
        ) : (
          <details className="validation-help">
            <summary>Field path help</summary>
            <p className="muted">
              Use a field from Source Processed Message, before this destination transforms it.
              JSON: patient.id; XML: Patient.ID; HL7: MSH.9. Nested paths use dots; array indexes
              start at 0.
            </p>
          </details>
        ))}
      {retainedEmptyComparison && (
        <p className="muted">
          This saved condition compares an empty value. Its existing behavior is retained until you
          edit the condition.
        </p>
      )}
      {mode === 'simple' && (
        <fieldset
          className="form-section"
          aria-label={`${label} simple condition`}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setShowConditionError(true);
          }}
        >
          <legend>Simple condition</legend>
          <div className="form-grid">
            <FieldPicker
              label="Field"
              value={condition.field}
              options={sourceFields}
              placeholder="patient.id"
              onChange={(field) => updateCondition({ ...condition, field })}
              error={conditionError && showConditionError ? conditionError : undefined}
            />
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
                <option value="neq">Not equals</option>
                <option value="isEmpty">Is empty</option>
                <option value="isNotEmpty">Is not empty</option>
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
                aria-invalid={!!conditionError && showConditionError}
                aria-describedby={conditionError && showConditionError ? errorId : undefined}
                onChange={(event) => updateCondition({ ...condition, value: event.target.value })}
              />
            </label>
          )}
          {conditionError && showConditionError && (
            <p id={errorId} className="alert error" role="alert">
              {conditionError}
            </p>
          )}
        </fieldset>
      )}
      {kind === 'destination' && allowAdvanced && (
        <details className="advanced-section">
          <summary>Advanced custom condition</summary>
          <p className="muted">
            Use msg from Source Processed Message. Return true to deliver, or false to skip only
            this destination. A custom condition replaces the simple condition when applied.
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setAdvancedError('');
              setAdvancedOpen(true);
            }}
          >
            Edit custom condition
          </Button>
          {advancedError && (
            <p className="alert error" role="alert">
              {advancedError}
            </p>
          )}
        </details>
      )}
      {kind === 'destination' && allowAdvanced && (
        <ScriptEditorModal
          isOpen={advancedOpen}
          onClose={() => setAdvancedOpen(false)}
          title="Destination custom condition"
          scriptType="filter"
          initialScript={value}
          onSave={(script) => {
            if (!script.trim()) {
              setAdvancedError('Enter a condition script that returns true or false.');
              setAdvancedOpen(false);
              return;
            }
            update(script);
            setMode(modeFor(script));
            const parsedCondition = readSimpleCondition(script);
            if (parsedCondition) setCondition(parsedCondition);
            setRetainedEmptyComparison(parsedCondition?.value === '');
            setConditionError('');
            setShowConditionError(false);
            validityCallback.current?.(true);
            setAdvancedOpen(false);
          }}
        />
      )}
    </div>
  );
}
