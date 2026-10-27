declare module '@ehr/hl7-v2' {
  interface Delimiters {
    field: string;
    component: string;
    repetition: string;
    escape: string;
    subComponent: string;
  }
  interface Generator {
    write(message: Record<string, unknown>): string;
    schema(schema?: Record<string, unknown>, merge?: boolean): Record<string, unknown>;
    writeSegment(segment: Record<string, unknown>, name: string): string;
    writeField(value: unknown, name: string): string;
  }
  const hl7: { Generator: new (schema?: unknown, delimiters?: Delimiters) => Generator };
  export default hl7;
}
