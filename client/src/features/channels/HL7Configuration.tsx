import { type FieldOption } from '../../components/ui/FieldExplorer';
import { Button } from '../../components/ui/Button';
import {
  defaultHl7Configuration,
  hl7TargetFields,
  hl7Templates,
  type Hl7Configuration,
  type Hl7MessageType,
  describeHl7Field,
  normalizeHl7Path,
} from '../../../../server/src/utils/hl7Configuration';

const segmentNames: Record<string, string> = {
  MSH: 'Message header',
  EVN: 'Event type',
  PID: 'Patient identification',
  PV1: 'Patient visit',
  ORC: 'Common order',
  OBR: 'Observation request',
  OBX: 'Observation result',
};
export function hl7TargetOptions(messageType: Hl7MessageType): FieldOption[] {
  const roots: FieldOption[] = [];
  const nodes = new Map<string, FieldOption>();
  for (const field of hl7TargetFields(messageType)) {
    let parent: FieldOption | undefined;
    const parts = field.path.split('.');
    for (let depth = 1; depth <= parts.length; depth++) {
      const path = parts.slice(0, depth).join('.');
      let node = nodes.get(path);
      if (!node) {
        node = {
          path,
          label: depth === 1 ? `${path} — ${segmentNames[path] || path}` : path.replace('.', '-'),
          selectable: false,
          children: [],
        };
        nodes.set(path, node);
        if (parent) parent.children!.push(node);
        else roots.push(node);
      }
      if (depth === parts.length) {
        node.label = `${field.code} — ${field.label}${field.required ? ' (required)' : ''}`;
        node.description = field.label;
        node.selectable = true;
      }
      parent = node;
    }
  }
  return roots;
}
export function hl7FieldDescription(path: string) {
  const normalized = normalizeHl7Path(path.replace(/\[[0-9]+\]/g, ''));
  const description = describeHl7Field(normalized);
  if (!description) return path ? 'Custom HL7 field' : 'Select a target field';
  if (normalized === 'PID.5') return `${description} · Full text; no name splitting`;
  if (normalized === 'PID.3.1') return `${describeHl7Field('PID.3')} · ${description}`;
  return description;
}
export function hl7TargetSelection(path: string, conversion?: string, previousTarget = '') {
  return {
    target: path.trim().replace(/^([A-Z0-9]{3})(\[[0-9]+\])?-/, '$1$2.'),
    ...(normalizeHl7Path(path) === 'PID.7' &&
    normalizeHl7Path(previousTarget) !== 'PID.7' &&
    (!conversion || conversion === 'NONE')
      ? { conversion: 'DATE_TO_HL7' as const }
      : {}),
  };
}
type ConfigurationProps = {
  value: Hl7Configuration;
  onChange: (value: Hl7Configuration) => void;
};
export function HL7Configuration({ value, onChange }: ConfigurationProps) {
  return (
    <section className="hl7-configuration" aria-label="HL7 message configuration">
      <div className="form-grid">
        <label className="field">
          <span>Message type</span>
          <select
            value={value.messageType}
            onChange={(event) => {
              const messageType = event.target.value as Hl7MessageType;
              const oldDefault = defaultHl7Configuration(value.messageType);
              const nextDefault = defaultHl7Configuration(messageType);
              onChange({
                ...value,
                messageType,
                patientClass:
                  value.patientClass === oldDefault.patientClass
                    ? nextDefault.patientClass
                    : value.patientClass,
              });
            }}
          >
            {hl7Templates.map((entry) => (
              <option value={entry.messageType} key={entry.messageType}>
                {entry.messageType} — {entry.label}
              </option>
            ))}
          </select>
        </label>
        <div className="field hl7-version">
          <span>HL7 version</span>
          <output aria-label="HL7 version">{value.version}</output>
        </div>
      </div>
    </section>
  );
}
export function HL7AdvancedSettings({ value, onChange }: ConfigurationProps) {
  return (
    <div className="hl7-advanced-fields">
      <p className="muted">
        Message time and control ID are generated automatically unless mapped or overridden.
      </p>
      {(value.messageDateTime || value.messageControlId) && (
        <div className="form-section">
          <p className="muted" role="status">
            Saved timestamp/control ID overrides are retained.
          </p>
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                onChange({
                  ...value,
                  messageDateTime: undefined,
                  messageControlId: undefined,
                })
              }
            >
              Use generated time and ID
            </Button>
          </div>
        </div>
      )}
      <div className="form-grid">
        {(
          [
            ['sendingApplication', 'Sending application'],
            ['sendingFacility', 'Sending facility'],
            ['receivingApplication', 'Receiving application'],
            ['receivingFacility', 'Receiving facility'],
          ] as const
        ).map(([field, label]) => (
          <label className="field" key={field}>
            <span>{label}</span>
            <input
              value={value[field]}
              maxLength={100}
              onChange={(event) => onChange({ ...value, [field]: event.target.value })}
            />
          </label>
        ))}
        <label className="field">
          <span>Processing ID</span>
          <select
            value={value.processingId}
            onChange={(event) =>
              onChange({
                ...value,
                processingId: event.target.value as Hl7Configuration['processingId'],
              })
            }
          >
            <option value="T">T — Test</option>
            <option value="P">P — Production</option>
            <option value="D">D — Debugging</option>
          </select>
        </label>
        <label className="field">
          <span>Patient class</span>
          <select
            value={value.patientClass}
            onChange={(event) =>
              onChange({
                ...value,
                patientClass: event.target.value as Hl7Configuration['patientClass'],
              })
            }
          >
            {[
              ['I', 'Inpatient'],
              ['O', 'Outpatient'],
              ['E', 'Emergency'],
              ['P', 'Preadmit'],
              ['R', 'Recurring'],
              ['B', 'Obstetrics'],
              ['C', 'Commercial account'],
              ['N', 'Not applicable'],
              ['U', 'Unknown'],
            ].map(([code, label]) => (
              <option key={code} value={code}>
                {code} — {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Assigning authority</span>
          <input
            value={value.assigningAuthority || ''}
            maxLength={100}
            onChange={(event) =>
              onChange({ ...value, assigningAuthority: event.target.value || undefined })
            }
          />
        </label>
        <label className="field">
          <span>Identifier type</span>
          <input
            value={value.identifierType || ''}
            maxLength={100}
            onChange={(event) =>
              onChange({ ...value, identifierType: event.target.value || undefined })
            }
          />
        </label>
      </div>
    </div>
  );
}
