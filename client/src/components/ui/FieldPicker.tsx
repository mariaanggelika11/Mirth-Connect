import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FieldExplorer, type FieldOption } from './FieldExplorer';
export type { FieldOption } from './FieldExplorer';
export function FieldPicker({
  label,
  value,
  onChange,
  options,
  error,
  placeholder = 'Search or enter a field path',
  allowManual = true,
  presentation = 'input',
  displayValue,
  hideLabel = false,
}: {
  label: string;
  value: string;
  onChange: (path: string) => void;
  options: FieldOption[];
  error?: string;
  placeholder?: string;
  allowManual?: boolean;
  presentation?: 'input' | 'dropdown';
  displayValue?: (path: string) => string;
  hideLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || presentation !== 'dropdown') return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    root.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open, presentation]);
  return (
    <div
      className={`field-picker ${presentation === 'dropdown' ? 'field-dropdown' : ''}`}
      ref={root}
      onBlur={(event) => {
        if (presentation === 'dropdown' && !event.currentTarget.contains(event.relatedTarget))
          setOpen(false);
      }}
    >
      {presentation === 'dropdown' ? (
        <>
          {!hideLabel && <span className="field-picker-label">{label.replace(/ \d+$/, '')}</span>}
          <button
            ref={trigger}
            type="button"
            className="field-dropdown-trigger"
            aria-label={label}
            aria-expanded={open}
            aria-controls={`${id}-options`}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            onClick={() => setOpen(!open)}
          >
            <span>{value ? displayValue?.(value) || value : placeholder}</span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        </>
      ) : (
        <label className={`field ${hideLabel ? 'field-picker-unlabelled' : ''}`} htmlFor={id}>
          {!hideLabel && <span>{label.replace(/ \d+$/, '')}</span>}
          <input
            id={id}
            aria-label={label}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            readOnly={!allowManual}
          />
        </label>
      )}
      {!!options.length && presentation === 'input' && (
        <button
          type="button"
          className="field-picker-trigger"
          aria-expanded={open}
          aria-controls={`${id}-options`}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Hide fields' : 'Choose field'}
        </button>
      )}
      {open && (
        <div
          id={`${id}-options`}
          className={`field-picker-options ${presentation === 'dropdown' ? 'field-picker-popover' : ''}`}
        >
          <FieldExplorer
            fields={options}
            label={`${label} choices`}
            onSelect={(field) => {
              onChange(field.path);
              setOpen(false);
              trigger.current?.focus();
            }}
          />
          {presentation === 'dropdown' && allowManual && (
            <details className="field-picker-manual">
              <summary>Advanced field path</summary>
              <label className="field">
                <span>Custom field path</span>
                <input
                  aria-label={`Custom ${label}`}
                  value={value}
                  spellCheck={false}
                  onChange={(event) => onChange(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="field-picker-trigger"
                onClick={() => {
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                Use field path
              </button>
            </details>
          )}
        </div>
      )}
      {error && (
        <small id={`${id}-error`} className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
