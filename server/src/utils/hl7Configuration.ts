/** Curated v2.5 mapping profiles, not a complete HL7 specification or facility conformance claim.
 * Segment families: https://hl7.org/fhir/uv/v2mappings/STU1/message_maps.html
 * Vocabulary: https://hl7.org/fhir/R4/v2/0001/index.html
 */
export type Hl7MessageType = 'ADT^A04' | 'ADT^A01' | 'ORU^R01' | 'ORM^O01';
export interface Hl7Configuration {
  version: '2.5';
  messageType: Hl7MessageType;
  sendingApplication: string;
  sendingFacility: string;
  receivingApplication: string;
  receivingFacility: string;
  processingId: 'P' | 'T' | 'D';
  messageDateTime?: string;
  messageControlId?: string;
  patientClass: 'I' | 'O' | 'E' | 'P' | 'R' | 'B' | 'C' | 'N' | 'U';
  assigningAuthority?: string;
  identifierType?: string;
}
export interface Hl7TargetField {
  path: string;
  code: string;
  label: string;
  segment: string;
  required?: boolean;
}
export interface Hl7Template {
  messageType: Hl7MessageType;
  label: string;
  structure: string;
  segments: string[];
  requiredFields: string[];
}
export const hl7Templates: Hl7Template[] = [
  {
    messageType: 'ADT^A04',
    label: 'Patient registration',
    structure: 'ADT_A01',
    segments: ['MSH', 'EVN', 'PID', 'PV1'],
    requiredFields: ['PID.3', 'PID.5'],
  },
  {
    messageType: 'ADT^A01',
    label: 'Patient admission',
    structure: 'ADT_A01',
    segments: ['MSH', 'EVN', 'PID', 'PV1'],
    requiredFields: ['PID.3', 'PID.5'],
  },
  {
    messageType: 'ORU^R01',
    label: 'Observation result (one order)',
    structure: 'ORU_R01',
    segments: ['MSH', 'PID', 'PV1', 'OBR', 'OBX'],
    requiredFields: ['PID.3', 'PID.5', 'OBR.4', 'OBX.3', 'OBX.5'],
  },
  {
    messageType: 'ORM^O01',
    label: 'New observation order',
    structure: 'ORM_O01',
    segments: ['MSH', 'PID', 'PV1', 'ORC', 'OBR'],
    requiredFields: ['PID.3', 'PID.5', 'ORC.2', 'OBR.4'],
  },
];
const fields: [string, string][] = [
  ['MSH.3', 'Sending application'],
  ['MSH.4', 'Sending facility'],
  ['MSH.5', 'Receiving application'],
  ['MSH.6', 'Receiving facility'],
  ['MSH.7', 'Message date/time'],
  ['MSH.10', 'Message control ID'],
  ['EVN.1', 'Event type code'],
  ['EVN.2', 'Recorded date/time'],
  ['PID.1', 'Patient set ID'],
  ['PID.3', 'Patient identifier'],
  ['PID.3.1', 'Identifier value'],
  ['PID.3.4', 'Assigning authority'],
  ['PID.3.5', 'Identifier type'],
  ['PID.5', 'Patient name'],
  ['PID.5.1', 'Family name'],
  ['PID.5.2', 'Given name'],
  ['PID.5.3', 'Additional given names'],
  ['PID.7', 'Date of birth'],
  ['PID.8', 'Administrative sex'],
  ['PID.11.1', 'Street address'],
  ['PID.11.3', 'City'],
  ['PID.13.1', 'Telephone'],
  ['PV1.1', 'Visit set ID'],
  ['PV1.2', 'Patient class'],
  ['PV1.3.1', 'Point of care'],
  ['PV1.19.1', 'Visit number'],
  ['ORC.1', 'Order control (new order)'],
  ['ORC.2', 'Placer order number'],
  ['ORC.3', 'Filler order number'],
  ['OBR.1', 'Order set ID'],
  ['OBR.2', 'Placer order number'],
  ['OBR.3', 'Filler order number'],
  ['OBR.4', 'Service identifier'],
  ['OBR.4.1', 'Service code'],
  ['OBR.4.2', 'Service description'],
  ['OBR.4.3', 'Coding system'],
  ['OBR.7', 'Observation date/time'],
  ['OBR.25', 'Result status'],
  ['OBX.1', 'Observation set ID'],
  ['OBX.2', 'Value type (ST, TX or NM)'],
  ['OBX.3', 'Observation identifier'],
  ['OBX.3.1', 'Observation code'],
  ['OBX.3.2', 'Observation description'],
  ['OBX.3.3', 'Coding system'],
  ['OBX.4', 'Observation sub-ID'],
  ['OBX.5', 'Observation value'],
  ['OBX.6', 'Units'],
  ['OBX.7', 'Reference range'],
  ['OBX.8', 'Abnormal flag'],
  ['OBX.11', 'Result status'],
  ['OBX.14', 'Observation date/time'],
];
export const hl7FieldDescriptions: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries([
    ...fields,
    ['MSH.1', 'Field separator'],
    ['MSH.2', 'Encoding characters'],
    ['MSH.9', 'Message type'],
    ['MSH.9.1', 'Message code'],
    ['MSH.9.2', 'Trigger event'],
    ['MSH.9.3', 'Message structure'],
    ['MSH.11', 'Processing ID'],
    ['MSH.12', 'Version ID'],
  ]),
);
export function describeHl7Field(path: string): string | undefined {
  return hl7FieldDescriptions[normalizeHl7Path(path)];
}
export function hl7TargetFields(messageType: Hl7MessageType): Hl7TargetField[] {
  const template = hl7Templates.find((item) => item.messageType === messageType);
  if (!template) return [];
  return fields
    .filter(([path]) => template.segments.includes(path.split('.')[0]))
    .map(([path, label]) => ({
      path,
      code: path.replace('.', '-'),
      label,
      segment: path.split('.')[0],
      required: template.requiredFields.includes(path),
    }));
}
export function defaultHl7Configuration(messageType: Hl7MessageType = 'ADT^A04'): Hl7Configuration {
  return {
    version: '2.5',
    messageType,
    sendingApplication: 'MINI_MIRTH',
    sendingFacility: 'TEST',
    receivingApplication: 'HL7_RECEIVER',
    receivingFacility: 'TEST',
    processingId: 'T',
    patientClass: messageType === 'ADT^A01' ? 'I' : 'O',
    assigningAuthority: 'TEST',
    identifierType: 'MR',
  };
}
export function normalizeHl7Path(value: string): string {
  return value
    .trim()
    .replace(/^([A-Z0-9]{3})(\[(?:0|[1-9][0-9]{0,2})\])?-/, '$1$2.')
    .replace(/\[([0-9]+)\]/g, '.$1');
}
export function validCalendarDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4)),
    month = Number(value.slice(4, 6)),
    day = Number(value.slice(6, 8));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
export function validHl7Timestamp(value: string): boolean {
  const offsetHour = Number(value.slice(15, 17));
  const offsetMinute = Number(value.slice(17, 19));
  return (
    /^\d{14}(?:[+-]\d{4})?$/.test(value) &&
    validCalendarDate(value.slice(0, 8)) &&
    Number(value.slice(8, 10)) < 24 &&
    Number(value.slice(10, 12)) < 60 &&
    Number(value.slice(12, 14)) < 60 &&
    (value.length === 14 ||
      (offsetHour <= 14 && offsetMinute <= 59 && (offsetHour !== 14 || offsetMinute === 0)))
  );
}
export function validateHl7Configuration(input: unknown): Hl7Configuration {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Configure the HL7 message header.');
  const value = input as Record<string, unknown>;
  const keys = [
    'version',
    'messageType',
    'sendingApplication',
    'sendingFacility',
    'receivingApplication',
    'receivingFacility',
    'processingId',
    'messageDateTime',
    'messageControlId',
    'patientClass',
    'assigningAuthority',
    'identifierType',
  ];
  if (
    Object.keys(value).some((key) => !keys.includes(key)) ||
    value.version !== '2.5' ||
    !hl7Templates.some((item) => item.messageType === value.messageType)
  )
    throw new Error('Choose a supported HL7 v2.5 message template.');
  for (const key of [
    'sendingApplication',
    'sendingFacility',
    'receivingApplication',
    'receivingFacility',
  ])
    if (
      typeof value[key] !== 'string' ||
      !value[key].trim() ||
      value[key].length > 100 ||
      /[\x00-\x1f\x7f]/.test(value[key])
    )
      throw new Error(
        'Complete the HL7 sending and receiving applications and facilities (maximum 100 characters).',
      );
  if (!['P', 'T', 'D'].includes(String(value.processingId)))
    throw new Error('Choose production, test or debugging HL7 processing.');
  if (!['I', 'O', 'E', 'P', 'R', 'B', 'C', 'N', 'U'].includes(String(value.patientClass)))
    throw new Error('Choose a supported patient class.');
  for (const key of ['messageControlId', 'assigningAuthority', 'identifierType'])
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'string' ||
        value[key].length > 100 ||
        /[\x00-\x1f\x7f]/.test(value[key]))
    )
      throw new Error('HL7 header identifiers must be bounded text without control characters.');
  if (
    value.messageDateTime !== undefined &&
    value.messageDateTime !== '' &&
    (typeof value.messageDateTime !== 'string' || !validHl7Timestamp(value.messageDateTime))
  )
    throw new Error(
      'Use a valid message date/time in YYYYMMDDHHmmss format with an optional +/-HHMM offset.',
    );
  return { ...value } as unknown as Hl7Configuration;
}
