import { useId, useState } from 'react';
export interface FieldOption {
  path: string;
  label: string;
  description?: string;
  type?: string;
  selectable?: boolean;
  children?: FieldOption[];
}
export function FieldExplorer({
  fields,
  onSelect,
  label = 'Message fields',
  searchable = true,
}: {
  fields: FieldOption[];
  onSelect?: (field: FieldOption) => void;
  label?: string;
  searchable?: boolean;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const matches = (field: FieldOption): boolean =>
    [field.path, field.label, field.description || ''].join(' ').toLowerCase().includes(query) ||
    !!field.children?.some(matches);
  function nodes(values: FieldOption[]) {
    return values.filter(matches).map((field) => (
      <li key={field.path}>
        {field.children?.length ? (
          <details key={`${field.path}:${!!query}`} open={query ? true : undefined}>
            <summary>
              <span>{field.label}</span>
              {field.type && <small>{field.type}</small>}
            </summary>
            {field.description && !field.label.includes(field.description) && (
              <small className="muted">{field.description}</small>
            )}
            {onSelect && field.selectable !== false && (
              <button type="button" className="field-choice" onClick={() => onSelect(field)}>
                Select {field.path}
              </button>
            )}
            <ul>{nodes(field.children)}</ul>
          </details>
        ) : onSelect && field.selectable !== false ? (
          <button type="button" className="field-choice" onClick={() => onSelect(field)}>
            <span>{field.label}</span>
            {!field.description || !field.label.includes(field.description) ? (
              <small>{field.description || field.path}</small>
            ) : null}
          </button>
        ) : (
          <span className="field-leaf">
            {field.label}
            <small>{field.description || field.type}</small>
          </span>
        )}
      </li>
    ));
  }
  const id = useId();
  return (
    <section className="field-explorer" aria-label={label}>
      {searchable && (
        <label className="field" htmlFor={id}>
          <span>Search fields</span>
          <input
            id={id}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or path"
          />
        </label>
      )}
      {fields.length ? (
        <ul className="field-tree">{nodes(fields)}</ul>
      ) : (
        <p className="muted">No fields available. Analyze a synthetic sample in Source.</p>
      )}
      {!!fields.length && !fields.some(matches) && <p role="status">No matching fields.</p>}
    </section>
  );
}
