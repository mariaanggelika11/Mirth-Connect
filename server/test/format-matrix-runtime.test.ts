import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runtimeDatabase as db } from './support/runtimeDatabase.js';
import type { RuntimeConnector } from './support/runtimeDatabase.js';

vi.mock('../src/config/db.js', async () => {
  const { runtimeConnection: connection } = await import('./support/runtimeDatabase.js');
  return {
    getConnection: async () => connection,
    withTransaction: async (run: (tx: unknown) => Promise<unknown>) => run(connection),
  };
});

import { processInboundMessage } from '../src/services/messageProcessor.services.js';
import app from '../src/app.js';
import { runConfiguration } from '../src/services/dryRun.services.js';
import { compileFieldMapping } from '../src/utils/fieldMapping.js';
import { defaultHl7Configuration } from '../src/utils/hl7Configuration.js';
import { channelSchema } from '../src/utils/validator.js';
import { buildAck, hl7ToJson, parseSegments } from '../src/utils/hl7Converer.js';
import { MllpDecoder, frame } from '../src/utils/mllp.js';
import { encrypt } from '../src/utils/secrets.js';
import { logRow } from '../src/services/monitor/mapping.js';

type Format = 'JSON' | 'XML' | 'HL7V2';
const stamp = '20261018220000';
const sourceApiKey = 'synthetic-format-matrix-source-key';
const patient = {
  patient_id: 'SYNTHETIC-001',
  first_name: 'Budi',
  last_name: 'Santoso',
  dob: '1990-05-20',
  gender: 'M',
};
const hl7Input = `MSH|^~\\&|SYNTHETIC_SOURCE|TEST|ENGINE|TEST|${stamp}||ADT^A04|SYNTHETIC-IN-001|P|2.5\rEVN|A04|${stamp}\rPID|1||SYNTHETIC-001^^^TEST^MR||Santoso^Budi||19900520|M\rPV1|1|O\r`;
const inputs: Record<Format, typeof patient | string> = {
  JSON: patient,
  XML: '<Patient origin="SYNTHETIC"><PatientID>SYNTHETIC-001</PatientID><FirstName>Budi</FirstName><LastName>Santoso</LastName><BirthDate>1990-05-20</BirthDate><Gender>M</Gender></Patient>',
  HL7V2: hl7Input,
};
const sourcePaths: Record<Format, string[]> = {
  JSON: ['patient_id', 'first_name', 'last_name', 'dob', 'gender'],
  XML: [
    'Patient.PatientID',
    'Patient.FirstName',
    'Patient.LastName',
    'Patient.BirthDate',
    'Patient.Gender',
  ],
  HL7V2: ['PID-3.1', 'PID-5.2', 'PID-5.1', 'PID-7', 'PID-8'],
};
function mapping(from: Format, to: Format) {
  const targets =
    to === 'HL7V2'
      ? ['PID.3.1', 'PID.5.2', 'PID.5.1', 'PID.7', 'PID.8']
      : to === 'XML'
        ? ['PatientID', 'FirstName', 'LastName', 'BirthDate', 'Gender']
        : ['patientId', 'givenName', 'familyName', 'birthDate', 'gender'];
  return compileFieldMapping({
    version: 2,
    rows: sourcePaths[from].map((source, index) => ({
      source,
      target: targets[index],
      required: true,
      ...(index === 3 && from === 'HL7V2' && to !== 'HL7V2'
        ? { conversion: 'DATE_FROM_HL7' as const }
        : {}),
      ...(index === 3 && from !== 'HL7V2' && to === 'HL7V2'
        ? { conversion: 'DATE_TO_HL7' as const }
        : {}),
    })),
    ...(to === 'XML' ? { rootElement: 'Patient' } : {}),
    ...(to === 'HL7V2'
      ? {
          hl7: {
            ...defaultHl7Configuration('ADT^A04'),
            sendingApplication: 'SYNTHETIC_ENGINE',
            sendingFacility: 'TEST',
            receivingApplication: 'SYNTHETIC_RECEIVER',
            receivingFacility: 'TEST',
            messageDateTime: stamp,
            messageControlId: 'SYNTHETIC-OUT-001',
            processingId: 'P',
            assigningAuthority: 'TEST',
            identifierType: 'MR',
          },
        }
      : {}),
  });
}
const servers: net.Server[] = [];
const sockets = new Set<net.Socket>();
async function listen(server: net.Server) {
  servers.push(server);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return (server.address() as net.AddressInfo).port;
}
async function httpReceiver() {
  const received: { body: string; headers: http.IncomingHttpHeaders; method?: string }[] = [];
  const port = await listen(
    http.createServer((req, res) => {
      const body: Buffer[] = [];
      req.on('data', (chunk) => body.push(Buffer.from(chunk)));
      req.on('end', () => {
        received.push({
          body: Buffer.concat(body).toString('utf8'),
          headers: req.headers,
          method: req.method,
        });
        res.writeHead(200);
        res.end('SYNTHETIC-ACCEPTED');
      });
    }),
  );
  return { endpoint: `http://127.0.0.1:${port}/synthetic`, received };
}
async function mllpReceiver(ack: 'AA' | 'AE' | 'MISMATCH' | 'NONE' = 'AA') {
  const received: string[] = [];
  const port = await listen(
    net.createServer((socket) => {
      const decoder = new MllpDecoder();
      socket.on('data', (chunk) => {
        for (const raw of decoder.push(chunk)) {
          received.push(raw);
          if (ack === 'NONE') continue;
          const correlated =
            ack === 'MISMATCH' ? raw.replace('|SYNTHETIC-OUT-001|', '|SYNTHETIC-WRONG-ID|') : raw;
          const bytes = frame(buildAck(correlated, ack === 'AE' ? 'AE' : 'AA'));
          socket.write(bytes.subarray(0, 9));
          setTimeout(() => {
            if (!socket.destroyed) socket.write(bytes.subarray(9));
          }, 5);
        }
      });
    }),
  );
  return { endpoint: `mllp://127.0.0.1:${port}`, received };
}
function connector(endpoint: string, output: Format, script: string, id = 2): RuntimeConnector {
  return {
    id,
    channel_id: 1,
    name: `Synthetic ${output} receiver`,
    type: 'REST',
    endpoint,
    outbound_data_type: output,
    processing_script: script,
    filter_script: '',
    template_script: '',
    response_script: '',
    retry_enabled: false,
    max_retries: 0,
    retry_interval_seconds: 1,
    timeout_ms: 1000,
    is_enabled: true,
    is_deleted: false,
  };
}
function configuration() {
  return channelSchema.parse({
    name: 'Synthetic format matrix',
    source: { type: 'HTTP', inboundDataType: db.channel.inbound_data_type },
    processingScript: db.channel.processing_script,
    filterScript: db.channel.filter_script,
    validationProfile: JSON.parse(db.channel.validation_profile),
    destinations: db.destinations.map((dest) => ({
      id: dest.id,
      name: dest.name,
      type: dest.type,
      endpoint: dest.endpoint,
      outboundDataType: dest.outbound_data_type,
      processingScript: dest.processing_script,
      deliveryPolicy: dest.delivery_policy,
      filterScript: dest.filter_script,
      templateScript: dest.template_script,
      isEnabled: true,
      retryEnabled: false,
      maxRetries: 0,
      timeoutMs: dest.timeout_ms,
    })),
  });
}
beforeEach(() => {
  db.reset();
  db.channel.validation_profile = JSON.stringify({ basicSyntax: true });
  db.channel.source_api_key = encrypt(sourceApiKey);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const socket of sockets) socket.destroy();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});
function assertOutput(raw: string, output: Format) {
  if (output === 'JSON') {
    expect(JSON.parse(raw)).toEqual({
      patientId: 'SYNTHETIC-001',
      givenName: 'Budi',
      familyName: 'Santoso',
      birthDate: '1990-05-20',
      gender: 'M',
    });
  } else if (output === 'XML') {
    expect(raw).toContain('<PatientID>SYNTHETIC-001</PatientID>');
    expect(raw).toContain('<FirstName>Budi</FirstName>');
    expect(raw).toContain('<BirthDate>1990-05-20</BirthDate>');
    expect(raw).not.toContain('<raw>MSH');
  } else {
    expect(raw).not.toContain('\n');
    expect(raw.endsWith('\r')).toBe(true);
    const parsed = parseSegments(raw);
    expect(parsed.segments.map((segment) => segment.name)).toEqual(['MSH', 'EVN', 'PID', 'PV1']);
    expect(parsed.segments[0].fields).toMatchObject({
      1: '|',
      2: '^~\\&',
      3: 'SYNTHETIC_ENGINE',
      4: 'TEST',
      5: 'SYNTHETIC_RECEIVER',
      6: 'TEST',
      7: stamp,
      9: 'ADT^A04^ADT_A01',
      10: 'SYNTHETIC-OUT-001',
      11: 'P',
      12: '2.5',
    });
    expect(hl7ToJson(raw).PID).toMatchObject({
      3: { 1: 'SYNTHETIC-001' },
      5: { 1: 'Santoso', 2: 'Budi' },
      7: '19900520',
      8: 'M',
    });
  }
}

describe('Real sender format matrix, with only database persistence isolated', () => {
  it.each(['HTTP', 'MLLP'] as const)(
    'delivers the Mirth-shaped JSON MDM document through %s without mapping scripts',
    async (protocol) => {
      // An opt-in local path verifies the exact user attachment without committing
      // its identifiers or embedded image. CI uses the sanitized structural fixture.
      const input = JSON.parse(
        readFileSync(
          process.env.MIRTH_HL7_SAMPLE_PATH ||
            new URL('./fixtures/mdm-teleport.json', import.meta.url),
          'utf8',
        ),
      );
      const digest = (value: string) => createHash('sha256').update(value).digest('hex');
      const original = digest(JSON.stringify(input));
      const httpLocal = protocol === 'HTTP' ? await httpReceiver() : null;
      const mllpLocal = protocol === 'MLLP' ? await mllpReceiver('AA') : null;
      db.destinations = [
        {
          ...connector(httpLocal?.endpoint || mllpLocal!.endpoint, 'HL7V2', ''),
          type: protocol === 'HTTP' ? 'REST' : 'MLLP',
        },
      ];
      const preview = await runConfiguration(configuration(), input);
      expect(preview.success).toBe(true);
      expect(preview.networkDelivery).toBe('NOT_SENT');
      expect((httpLocal || mllpLocal)!.received).toHaveLength(0);
      expect(db.writes).toHaveLength(0);
      const response = await request(app)
        .post('/api/inbound/1')
        .set('X-API-Key', sourceApiKey)
        .send(input);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ success: true, status: 'SUCCESS' });
      expect((httpLocal || mllpLocal)!.received).toHaveLength(1);
      const raw = httpLocal ? httpLocal.received[0].body : mllpLocal!.received[0];
      const parsed = parseSegments(raw).segments;
      const previewParsed = parseSegments(String(preview.results[0].finalPayload)).segments;
      expect(parsed.map((s) => s.name)).toEqual(['MSH', 'PID', 'PV1', 'TXA', 'OBX', 'NTE']);
      expect(parsed[0].fields[9]).toBe('MDM^T02');
      expect(parsed[0].fields[12]).toBe('2.3');
      expect(parsed[0].fields[10]).toMatch(/^[a-f0-9-]{36}$/);
      expect(parsed[0].fields[7]).toMatch(/^\d{14}\+0000$/);
      const image = parsed.find((s) => s.name === 'OBX')!.fields[5].split('^')[4];
      expect(digest(image)).toBe(digest(input.HL7Message.OBX['OBX.5']['OBX.5.5']));
      expect(digest(JSON.stringify(parsed.slice(1)))).toBe(
        digest(JSON.stringify(previewParsed.slice(1))),
      );
      expect(digest(JSON.stringify(input))).toBe(original);
      expect(raw).not.toMatch(/\n|\{\{CR13\}\}|&amp;/);
      const outbound = [...db.messages.values()].find((row) => row.destination_id === 2)!;
      expect(digest(JSON.parse(outbound.transformed_payload))).toBe(digest(raw));
      expect(db.attempts[0]).toMatchObject({ dest: 2, status: 'OUT-SENT' });
      if (httpLocal) {
        expect(httpLocal.received[0].headers['content-type']).toMatch(
          /^application\/hl7-v2(?:;|$)/,
        );
        expect(httpLocal.received[0].headers['x-correlation-id']).toBe(
          response.headers['x-request-id'],
        );
      } else expect(db.attempts[0]).toMatchObject({ ack: 'AA' });
    },
  );
  it.each([
    ['JSON', 'JSON'],
    ['JSON', 'XML'],
    ['JSON', 'HL7V2'],
    ['XML', 'JSON'],
    ['XML', 'HL7V2'],
    ['HL7V2', 'JSON'],
    ['HL7V2', 'XML'],
    ['HL7V2', 'HL7V2'],
  ] as [Format, Format][])(
    '%s → %s maps actual data, preserves preview parity and delivers the selected format',
    async (from, to) => {
      const local = await httpReceiver();
      db.channel.inbound_data_type = from;
      db.destinations = [connector(local.endpoint, to, mapping(from, to))];
      const original = structuredClone(inputs[from]);
      const preview = await runConfiguration(configuration(), inputs[from]);
      expect(
        preview.success,
        JSON.stringify({
          sourceCode: preview.source.code,
          results: preview.results.map(({ code, message, stages }) => ({ code, message, stages })),
        }),
      ).toBe(true);
      expect(preview.accepted).toBe(true);
      expect(preview.networkDelivery).toBe('NOT_SENT');
      expect(local.received).toEqual([]);
      expect(db.writes).toEqual([]);
      const response = await request(app)
        .post('/api/inbound/1')
        .set('X-API-Key', sourceApiKey)
        .set(
          'Content-Type',
          from === 'JSON'
            ? 'application/json'
            : from === 'XML'
              ? 'application/xml'
              : 'application/hl7-v2',
        )
        .send(inputs[from]);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ success: true, status: 'SUCCESS' });
      expect(local.received).toHaveLength(1);
      assertOutput(local.received[0].body, to);
      expect(local.received[0].headers['content-type']).toMatch(
        new RegExp(
          `^${to === 'JSON' ? 'application/json' : to === 'XML' ? 'application/xml' : 'application/hl7-v2'}(?:;|$)`,
        ),
      );
      const expectedBody =
        typeof preview.results[0].finalPayload === 'string'
          ? preview.results[0].finalPayload
          : JSON.stringify(preview.results[0].finalPayload);
      expect(local.received[0].body).toBe(expectedBody);
      expect(local.received[0].headers['x-correlation-id']).toBe(response.headers['x-request-id']);
      const outbound = [...db.messages.values()].find((row) => row.destination_id === 2)!;
      expect(JSON.parse(outbound.transformed_payload)).toEqual(preview.results[0].finalPayload);
      expect(db.attempts[0]).toMatchObject({ dest: 2, httpStatus: 200, status: 'OUT-SENT' });
      expect(inputs[from]).toEqual(original);
    },
  );

  it('delivers the compact four-field mapping with automatic headers, ISO birth date and an unsplit full name', async () => {
    const local = await httpReceiver();
    db.destinations = [
      connector(
        local.endpoint,
        'HL7V2',
        compileFieldMapping({
          version: 2,
          hl7: defaultHl7Configuration(),
          rows: [
            { source: 'patient_id', target: 'PID.3.1', required: true },
            { source: 'name', target: 'PID.5', required: true },
            { source: 'birth_date', target: 'PID.7', required: false, conversion: 'DATE_TO_HL7' },
            { source: 'gender', target: 'PID.8', required: false },
          ],
        }),
      ),
    ];
    const input = {
      patient_id: 'RM001',
      name: 'Budi Santoso',
      birth_date: '1990-05-20',
      gender: 'M',
    };
    const preview = await runConfiguration(configuration(), input);
    expect(preview.success).toBe(true);
    expect(local.received).toEqual([]);
    expect((await processInboundMessage(1, input)).inboundStatus).toBe('SUCCESS');
    expect(local.received).toHaveLength(1);
    const raw = local.received[0].body;
    expect(raw).not.toContain('\n');
    expect(raw.endsWith('\r')).toBe(true);
    expect(raw).toContain('||Budi Santoso||19900520|M');
    expect(raw).not.toContain('Santoso^Budi');
    expect(hl7ToJson(raw).PID).toMatchObject({
      3: { 1: 'RM001' },
      5: 'Budi Santoso',
      7: '19900520',
      8: 'M',
    });
    const liveHeader = parseSegments(raw).segments[0].fields;
    const previewRaw = String(preview.results[0].finalPayload);
    const previewSegments = parseSegments(previewRaw).segments;
    const liveSegments = parseSegments(raw).segments;
    expect(previewSegments.find((s) => s.name === 'EVN')!.fields[2]).toBe(
      previewSegments[0].fields[7],
    );
    expect(liveSegments.find((s) => s.name === 'EVN')!.fields[2]).toBe(liveHeader[7]);
    const withoutGeneratedTime = (segments: typeof liveSegments) =>
      segments.slice(1).map((s) => ({
        ...s,
        fields:
          s.name === 'EVN' ? s.fields.map((v, i) => (i === 2 ? 'GENERATED_TIME' : v)) : s.fields,
      }));
    expect(withoutGeneratedTime(previewSegments)).toEqual(withoutGeneratedTime(liveSegments));
    expect(liveHeader[7]).toMatch(/^\d{14}\+0000$/);
    expect(liveHeader[10]).toMatch(/^[0-9a-f-]{36}$/);
    expect(liveHeader[12]).toBe('2.5');
    expect(local.received[0].headers['content-type']).toMatch(/^application\/hl7-v2/);
  });

  it.each([
    { patient_id: 'RM001', name: 'Budi Santoso', birth_date: '1990-02-30' },
    { patient_id: 'RM001', birth_date: '1990-05-20' },
  ])('rejects an invalid compact mapping value before any delivery', async (input) => {
    const local = await httpReceiver();
    db.destinations = [
      connector(
        local.endpoint,
        'HL7V2',
        compileFieldMapping({
          version: 2,
          hl7: defaultHl7Configuration(),
          rows: [
            { source: 'patient_id', target: 'PID.3.1', required: true },
            { source: 'name', target: 'PID.5', required: true },
            { source: 'birth_date', target: 'PID.7', required: false, conversion: 'DATE_TO_HL7' },
          ],
        }),
      ),
    ];
    const preview = await runConfiguration(configuration(), input);
    expect(preview.success).toBe(false);
    expect(preview.results[0].status).toBe('ERROR');
    expect((await processInboundMessage(1, input)).inboundStatus).toBe('FAILED');
    expect(local.received).toEqual([]);
    expect(db.attempts).toEqual([]);
  });

  it('delivers independent JSON, XML and HL7 bodies from one source without sharing destination state', async () => {
    const json = await httpReceiver(),
      xml = await httpReceiver(),
      hl7 = await httpReceiver();
    db.destinations = [
      connector(json.endpoint, 'JSON', mapping('JSON', 'JSON'), 2),
      connector(xml.endpoint, 'XML', mapping('JSON', 'XML'), 3),
      connector(hl7.endpoint, 'HL7V2', mapping('JSON', 'HL7V2'), 4),
    ];
    const preview = await runConfiguration(configuration(), inputs.JSON);
    expect(preview.success).toBe(true);
    expect((await processInboundMessage(1, inputs.JSON)).inboundStatus).toBe('SUCCESS');
    for (const [index, receiver, format] of [
      [0, json, 'JSON'],
      [1, xml, 'XML'],
      [2, hl7, 'HL7V2'],
    ] as const) {
      expect(receiver.received).toHaveLength(1);
      assertOutput(receiver.received[0].body, format);
      const expected = preview.results[index].finalPayload;
      expect(receiver.received[0].body).toBe(
        typeof expected === 'string' ? expected : JSON.stringify(expected),
      );
    }
    expect(db.attempts.map((attempt) => attempt.dest)).toEqual([2, 3, 4]);
  });

  it.each([
    ['AA', 'SUCCESS', null],
    ['AE', 'FAILED', 'HL7_NACK_AE'],
    ['MISMATCH', 'FAILED', 'INVALID_ACK'],
    ['NONE', 'FAILED', 'DESTINATION_TIMEOUT'],
  ] as const)(
    'uses actual MLLP framing and correlated %s ACK handling',
    async (ack, status, error) => {
      const local = await mllpReceiver(ack);
      db.destinations = [
        {
          ...connector(local.endpoint, 'HL7V2', mapping('JSON', 'HL7V2')),
          type: 'MLLP',
          timeout_ms: ack === 'NONE' ? 100 : 1000,
        },
      ];
      const result = await processInboundMessage(1, inputs.JSON);
      expect(result.inboundStatus).toBe(status);
      expect(local.received).toHaveLength(1);
      assertOutput(local.received[0], 'HL7V2');
      expect(db.attempts[0]).toMatchObject({
        httpStatus: null,
        ack: ack === 'AA' ? 'AA' : ack === 'AE' ? 'AE' : null,
      });
      expect([...db.messages.values()].find((row) => row.destination_id === 2)?.last_error).toBe(
        error,
      );
      if (ack === 'MISMATCH' || ack === 'NONE')
        expect([...db.messages.values()].find((row) => row.destination_id === 2)?.status).toBe(
          'DEAD_LETTER',
        );
    },
  );

  it('escapes control/delimiter data rather than injecting new HL7 fields or segments', async () => {
    const local = await mllpReceiver();
    db.destinations = [
      { ...connector(local.endpoint, 'HL7V2', mapping('JSON', 'HL7V2')), type: 'MLLP' },
    ];
    const malicious = { ...patient, last_name: 'Synthetic|Name^Extra~Repeat&Sub\\folder\rOBX|1\n' };
    expect((await processInboundMessage(1, malicious)).inboundStatus).toBe('SUCCESS');
    const raw = local.received[0];
    expect(parseSegments(raw).segments.map((segment) => segment.name)).toEqual([
      'MSH',
      'EVN',
      'PID',
      'PV1',
    ]);
    expect(raw).toContain(
      'Synthetic\\F\\Name\\S\\Extra\\R\\Repeat\\T\\Sub\\E\\folder\\X0D\\OBX\\F\\1\\X0A\\',
    );
  });

  it('selects an explicit repeated observation and subcomponent without silently choosing the first segment', async () => {
    const local = await httpReceiver();
    db.channel.inbound_data_type = 'HL7V2';
    const raw = hl7Input + 'OBX|1|ST|TEST||FIRST\rOBX|2|ST|TEST||SECOND&SUB\r';
    const script = compileFieldMapping({
      version: 2,
      rows: [
        { source: 'OBX.0.5', target: 'first', required: true },
        { source: 'OBX.1.5.1.1', target: 'second', required: true },
        { source: 'OBX.1.5.1.2', target: 'subcomponent', required: true },
      ],
    });
    db.destinations = [connector(local.endpoint, 'JSON', script)];
    expect((await processInboundMessage(1, raw)).inboundStatus).toBe('SUCCESS');
    expect(JSON.parse(local.received[0].body)).toEqual({
      first: 'FIRST',
      second: 'SECOND',
      subcomponent: 'SUB',
    });
  });

  it('selects explicit repetitions of a patient identifier field', async () => {
    const local = await httpReceiver();
    db.channel.inbound_data_type = 'HL7V2';
    const raw = hl7Input.replace(
      'SYNTHETIC-001^^^TEST^MR',
      'SYNTHETIC-001^^^TEST^MR~SYNTHETIC-ALT^^^TEST^PI',
    );
    db.destinations = [
      connector(
        local.endpoint,
        'JSON',
        compileFieldMapping({
          version: 2,
          rows: [
            { source: 'PID.3.0.1', target: 'primaryId', required: true },
            { source: 'PID.3.1.1', target: 'alternateId', required: true },
          ],
        }),
      ),
    ];
    expect((await processInboundMessage(1, raw)).inboundStatus).toBe('SUCCESS');
    expect(JSON.parse(local.received[0].body)).toEqual({
      primaryId: 'SYNTHETIC-001',
      alternateId: 'SYNTHETIC-ALT',
    });
  });

  it('does not guess a segment when a mapping path is ambiguous across repeated segments', async () => {
    const local = await httpReceiver();
    db.channel.inbound_data_type = 'HL7V2';
    const raw = hl7Input + 'PID|2||SYNTHETIC-SECOND\r';
    db.destinations = [
      connector(
        local.endpoint,
        'JSON',
        compileFieldMapping({
          version: 2,
          rows: [{ source: 'PID.3.1', target: 'patientId', required: true }],
        }),
      ),
    ];
    expect((await processInboundMessage(1, raw)).inboundStatus).toBe('FAILED');
    expect(local.received).toEqual([]);
    expect(db.attempts).toEqual([]);
  });

  it('preserves custom delimiters, escapes and repeats during compatible HL7 pass-through to a real MLLP receiver', async () => {
    const local = await mllpReceiver();
    db.channel.inbound_data_type = 'HL7V2';
    const raw = (hl7Input + 'OBX|1|ST|TEST||A\\F\\B~C&D\rOBX|2|ST|OTHER||SECOND\r')
      .replaceAll('|', '!')
      .replaceAll('^', '$')
      .replaceAll('~', '%')
      .replaceAll('\\', '?')
      .replaceAll('&', '@');
    db.destinations = [{ ...connector(local.endpoint, 'HL7V2', ''), type: 'MLLP' }];
    expect((await processInboundMessage(1, raw)).inboundStatus).toBe('SUCCESS');
    expect(local.received).toEqual([raw]);
    expect(db.attempts[0]).toMatchObject({ ack: 'AA', control: 'SYNTHETIC-IN-001' });
  });

  it('applies a missing-field default while rebuilding HL7 rather than merely relabeling the original message', async () => {
    const local = await httpReceiver();
    db.channel.inbound_data_type = 'HL7V2';
    const script = compileFieldMapping({
      version: 2,
      hl7: {
        ...defaultHl7Configuration('ADT^A04'),
        messageDateTime: stamp,
        messageControlId: 'SYNTHETIC-DEFAULT-001',
      },
      rows: [
        { source: 'PID.3.1', target: 'PID.3.1', required: true },
        { source: 'PID.5.1', target: 'PID.5.1', required: true },
        { source: 'PID.5.2', target: 'PID.5.2', required: true },
        { source: 'PID.5.99', target: 'PID.5.3', required: true, defaultValue: 'SYNTHETIC-MIDDLE' },
      ],
    });
    db.destinations = [connector(local.endpoint, 'HL7V2', script)];
    expect((await processInboundMessage(1, hl7Input)).inboundStatus).toBe('SUCCESS');
    expect(local.received[0].body).not.toBe(hl7Input);
    expect(hl7ToJson(local.received[0].body).PID).toMatchObject({
      5: { 1: 'Santoso', 2: 'Budi', 3: 'SYNTHETIC-MIDDLE' },
    });
    expect(parseSegments(local.received[0].body).segments[0].fields[10]).toBe(
      'SYNTHETIC-DEFAULT-001',
    );
  });

  it('converts number and Boolean values explicitly without losing zero or false', async () => {
    const local = await httpReceiver();
    db.destinations = [
      connector(
        local.endpoint,
        'JSON',
        compileFieldMapping({
          version: 2,
          rows: [
            { source: 'count', target: 'count', required: true, conversion: 'NUMBER' },
            { source: 'active', target: 'active', required: true, conversion: 'BOOLEAN' },
          ],
        }),
      ),
    ];
    expect((await processInboundMessage(1, { count: '0', active: 'false' })).inboundStatus).toBe(
      'SUCCESS',
    );
    expect(JSON.parse(local.received[0].body)).toEqual({ count: 0, active: false });
  });

  it('does not silently coerce arbitrary text to a Boolean during mapping', async () => {
    const local = await httpReceiver();
    db.destinations = [
      connector(
        local.endpoint,
        'JSON',
        compileFieldMapping({
          version: 2,
          rows: [{ source: 'active', target: 'active', required: true, conversion: 'BOOLEAN' }],
        }),
      ),
    ];
    expect(
      (await processInboundMessage(1, { active: 'SYNTHETIC-NOT-A-BOOLEAN' })).inboundStatus,
    ).toBe('FAILED');
    expect(local.received).toEqual([]);
    expect(db.attempts).toEqual([]);
  });

  it('rejects an impossible mapped birth date before any network attempt', async () => {
    const local = await httpReceiver();
    db.destinations = [connector(local.endpoint, 'HL7V2', mapping('JSON', 'HL7V2'))];
    const bad = { ...patient, dob: '2001-02-29' };
    const preview = await runConfiguration(configuration(), bad);
    expect(preview.success).toBe(false);
    expect((await processInboundMessage(1, bad)).inboundStatus).toBe('FAILED');
    expect(local.received).toEqual([]);
    expect(db.attempts).toEqual([]);
    expect(
      [...db.messages.values()].find((row) => row.destination_id === 2)?.transport_config,
    ).toBeNull();
  });

  it('uses a bounded XML attribute path as mapping data', async () => {
    const local = await httpReceiver();
    db.channel.inbound_data_type = 'XML';
    db.destinations = [
      connector(
        local.endpoint,
        'JSON',
        compileFieldMapping({
          version: 2,
          rows: [{ source: 'Patient.$.origin', target: 'source', required: true }],
        }),
      ),
    ];
    expect((await processInboundMessage(1, inputs.XML)).inboundStatus).toBe('SUCCESS');
    expect(JSON.parse(local.received[0].body)).toEqual({ source: 'SYNTHETIC' });
  });

  it('sends configured PUT HL7 text/plain, environment Bearer and vendor headers over the actual HTTP transport', async () => {
    const local = await httpReceiver();
    const bearer = 'synthetic-only-bearer-destination-2';
    const vendor = 'synthetic-only-vendor-destination-2';
    vi.stubEnv('MIRTH_DESTINATION_2_BEARER_TOKEN', bearer);
    vi.stubEnv('MIRTH_DESTINATION_2_VENDOR_KEY', vendor);
    db.destinations = [
      {
        ...connector(
          local.endpoint.replace('http://', 'http://legacy-user:legacy-password@'),
          'HL7V2',
          mapping('JSON', 'HL7V2'),
        ),
        delivery_policy: {
          http: {
            method: 'PUT',
            contentType: 'text/plain',
            authentication: 'BEARER',
            headers: [{ name: 'X-Vendor-Key', slot: 'VENDOR_KEY' }],
          },
        },
      },
    ];
    const preview = await runConfiguration(configuration(), inputs.JSON);
    expect(preview.success).toBe(true);
    expect(local.received).toEqual([]);
    expect((await processInboundMessage(1, inputs.JSON)).inboundStatus).toBe('SUCCESS');
    expect(local.received).toHaveLength(1);
    expect(local.received[0]).toMatchObject({
      method: 'PUT',
      headers: { authorization: 'Bearer ' + bearer, 'x-vendor-key': vendor },
    });
    expect(local.received[0].headers['content-type']).toMatch(/^text\/plain(?:;|$)/);
    assertOutput(local.received[0].body, 'HL7V2');
    expect(local.received[0].body).toBe(preview.results[0].finalPayload);
    const persisted = JSON.stringify({ configuration: configuration(), writes: db.writes });
    expect(persisted).not.toContain(bearer);
    expect(persisted).not.toContain(vendor);
  });

  it('sends configured PATCH JSON with environment Basic credentials instead of legacy URL userinfo', async () => {
    const local = await httpReceiver();
    const username = 'synthetic-basic-user-d2-ユーザー';
    const password = 'synthetic-basic-password-d2-密碼';
    vi.stubEnv('MIRTH_DESTINATION_2_BASIC_USERNAME', username);
    vi.stubEnv('MIRTH_DESTINATION_2_BASIC_PASSWORD', password);
    db.destinations = [
      {
        ...connector(
          local.endpoint.replace('http://', 'http://legacy-user:legacy-password@'),
          'JSON',
          mapping('JSON', 'JSON'),
        ),
        delivery_policy: { http: { method: 'PATCH', authentication: 'BASIC' } },
      },
    ];
    expect((await processInboundMessage(1, inputs.JSON)).inboundStatus).toBe('SUCCESS');
    expect(local.received).toHaveLength(1);
    expect(local.received[0]).toMatchObject({
      method: 'PATCH',
      headers: {
        authorization: 'Basic ' + Buffer.from(username + ':' + password).toString('base64'),
      },
    });
    assertOutput(local.received[0].body, 'JSON');
    const persisted = JSON.stringify({ configuration: configuration(), writes: db.writes });
    expect(persisted).not.toContain(username);
    expect(persisted).not.toContain(password);
  });

  it('resolves HTTP credential slots separately for each actual destination ID', async () => {
    const a = await httpReceiver();
    const b = await httpReceiver();
    vi.stubEnv('MIRTH_DESTINATION_2_BEARER_TOKEN', 'synthetic-bearer-only-A');
    vi.stubEnv('MIRTH_DESTINATION_3_BEARER_TOKEN', 'synthetic-bearer-only-B');
    vi.stubEnv('MIRTH_DESTINATION_2_VENDOR_KEY', 'synthetic-vendor-only-A');
    vi.stubEnv('MIRTH_DESTINATION_3_VENDOR_KEY', 'synthetic-vendor-only-B');
    const httpPolicy = {
      http: {
        authentication: 'BEARER' as const,
        headers: [{ name: 'X-Vendor-Key', slot: 'VENDOR_KEY' }],
      },
    };
    db.destinations = [
      { ...connector(a.endpoint, 'JSON', '', 2), delivery_policy: httpPolicy },
      { ...connector(b.endpoint, 'JSON', '', 3), delivery_policy: httpPolicy },
    ];
    expect((await processInboundMessage(1, inputs.JSON)).inboundStatus).toBe('SUCCESS');
    expect(a.received[0].headers).toMatchObject({
      authorization: 'Bearer synthetic-bearer-only-A',
      'x-vendor-key': 'synthetic-vendor-only-A',
    });
    expect(b.received[0].headers).toMatchObject({
      authorization: 'Bearer synthetic-bearer-only-B',
      'x-vendor-key': 'synthetic-vendor-only-B',
    });
    expect(a.received[0].headers['x-destination-id']).toBe('2');
    expect(b.received[0].headers['x-destination-id']).toBe('3');
  });

  it.each([
    ['BEARER', 'missing', undefined],
    ['BEARER', 'LF', 'synthetic\nInjected: value'],
    ['BEARER', 'CR', 'synthetic\rInjected: value'],
    ['BEARER', 'control', 'synthetic\u0001value'],
    ['BEARER', 'DEL', 'synthetic\u007fvalue'],
    ['BEARER', 'non-Latin', 'synthetic\u0100value'],
    ['CUSTOM', 'control', 'synthetic\u0001value'],
    ['CUSTOM', 'DEL', 'synthetic\u007fvalue'],
    ['CUSTOM', 'non-Latin', 'synthetic\u0100value'],
  ])(
    'rejects %s %s HTTP credentials without a request, retry or invented network timing',
    async (mode, _, credential) => {
      const local = await httpReceiver();
      vi.stubEnv('MIRTH_DESTINATION_2_BEARER_TOKEN', credential);
      vi.stubEnv('MIRTH_DESTINATION_2_VENDOR_KEY', credential);
      vi.stubEnv('MIRTH_DESTINATION_3_BEARER_TOKEN', 'synthetic-other-destination-token');
      db.destinations = [
        {
          ...connector(local.endpoint, 'JSON', ''),
          retry_enabled: true,
          max_retries: 3,
          delivery_policy: {
            http:
              mode === 'BEARER'
                ? { authentication: 'BEARER' }
                : { headers: [{ name: 'X-Vendor-Key', slot: 'VENDOR_KEY' }] },
          },
        },
      ];
      const result = await processInboundMessage(1, inputs.JSON);
      expect(result.inboundStatus).toBe('FAILED');
      expect(local.received).toEqual([]);
      const row = [...db.messages.values()].find((item) => item.destination_id === 2)!;
      expect(row).toMatchObject({
        status: 'OUT-ERROR',
        last_error: 'DESTINATION_CREDENTIAL_MISSING',
        retry_count: 0,
      });
      expect(db.writes.some((write) => write.inputs.status === 'QUEUED')).toBe(false);
      const attempt = db.attempts[0];
      expect(attempt).toMatchObject({
        httpStatus: null,
        requestDurationMs: null,
        response: 'DESTINATION_CREDENTIAL_MISSING',
      });
      const event = logRow(
        {
          id: 1,
          message_id: row.id,
          destination_id: 2,
          destination_name: 'Synthetic receiver',
          status: String(attempt.status),
          sent_at: new Date(),
          request_duration_ms: null,
          http_status: null,
          ack_code: attempt.ack as string,
          message_control_id: '',
          request_data: String(attempt.request),
          outbound_data: String(attempt.outbound),
          response_text: String(attempt.response),
          inbound_message_id: row.inbound_message_id!,
          attempt_count: 0,
          transport_config: row.transport_config!,
        },
        false,
      );
      expect(event).toMatchObject({
        eventKind: 'DELIVERY_REJECTION',
        networkAttempted: false,
        durationMs: null,
        attemptCount: 0,
      });
      expect(event.sentAt).toBeUndefined();
      if (credential) expect(JSON.stringify(db.writes)).not.toContain(credential);
    },
  );

  it('preserves legacy URL Basic authentication when no explicit environment authentication is selected', async () => {
    const local = await httpReceiver();
    db.destinations = [
      {
        ...connector(
          local.endpoint.replace(
            'http://',
            'http://synthetic-legacy-user:synthetic-legacy-password@',
          ),
          'JSON',
          '',
        ),
        delivery_policy: { http: { authentication: 'NONE' } },
      },
    ];
    expect((await processInboundMessage(1, inputs.JSON)).inboundStatus).toBe('SUCCESS');
    expect(local.received[0].headers.authorization).toBe(
      'Basic ' + Buffer.from('synthetic-legacy-user:synthetic-legacy-password').toString('base64'),
    );
  });
});
