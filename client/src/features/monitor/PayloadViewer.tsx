import { useState } from 'react';
import { Copy, Search } from 'lucide-react';
import { HL7Tree } from '../../components/hl7/HL7Tree';
function stringify(value: unknown, pretty: boolean) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') {
    if (pretty) {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value.replace(/\r\n?/g, '\n');
      }
    }
    return value;
  }
  return JSON.stringify(value, null, pretty ? 2 : undefined);
}
export function PayloadViewer({ title, value }: { title: string; value: unknown }) {
  const [mode, setMode] = useState('pretty'),
    [query, setQuery] = useState(''),
    [notice, setNotice] = useState('');
  const text = stringify(value, mode === 'pretty'),
    isHL7 = typeof value === 'string' && value.trim().startsWith('MSH');
  const parts = query
    ? text.split(new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'))
    : [text];
  return (
    <section className="payload-section">
      <div className="section-header">
        <h3>{title}</h3>
        <div className="payload-modes">
          {['pretty', 'raw', ...(isHL7 ? ['tree'] : [])].map((m) => (
            <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
          <button
            aria-label={`Copy ${title}`}
            title="Copy original content"
            onClick={() => {
              void navigator.clipboard
                .writeText(stringify(value, false))
                .then(() => setNotice('Copied to clipboard'))
                .catch(() => setNotice('Clipboard unavailable in this browser'));
            }}
          >
            <Copy size={14} />
          </button>
        </div>
      </div>
      {mode !== 'tree' && (
        <label className="search-field payload-search">
          <Search size={14} />
          <input
            aria-label={`Search ${title}`}
            placeholder="Find in payload…"
            maxLength={100}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <small>{query ? `${Math.floor(parts.length / 2)} matches` : ''}</small>
        </label>
      )}
      {notice && <small role="status">{notice}</small>}
      {mode === 'tree' ? (
        <div className="payload-code">
          <HL7Tree hl7={String(value)} />
        </div>
      ) : (
        <pre className="payload-code">
          {text
            ? parts.map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
            : 'No payload available'}
        </pre>
      )}
    </section>
  );
}
