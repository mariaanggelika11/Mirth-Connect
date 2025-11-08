import { Channel, ChannelStatus, DestinationType, LogEntry, LogLevel, MonitorStats } from "../types";

const generateId = (() => {
  let counter = 1;
  return () => counter++;
})();

// =====================
// MOCK CHANNELS
// =====================
export const MOCK_CHANNELS: Channel[] = [
  {
    id: generateId(), // number
    name: "Patient Admissions (ADT)",
    status: ChannelStatus.RUNNING,
    source: { type: "HTTP", endpoint: "/api/adt" },
    received: 1024,
    sent: 1020,
    errors: 4,
    processingScript: `msg['PATIENT_NAME'] = msg['FIRST_NAME'] + ' ' + msg['LAST_NAME'];\nreturn msg;`,
    responseScript: `return { status: 'success', messageId: msg.id };`,
    destinations: [
      {
        id: generateId(),
        channel_id: 1,
        name: "EMR HL7 Feed",
        type: DestinationType.HL7,
        endpoint: "emr.hospital.local:5000",
        sent: 1020,
        errors: 4,
        processingScript: "return msg;",
      },
      {
        id: generateId(),
        channel_id: 1,
        name: "Billing System REST API",
        type: DestinationType.REST,
        endpoint: "https://billing.hospital.local/api/patient",
        sent: 1020,
        errors: 0,
      },
    ],
  },
  {
    id: generateId(),
    name: "Lab Results (ORU)",
    status: ChannelStatus.STOPPED,
    source: { type: "HTTP", endpoint: "/api/oru" },
    received: 512,
    sent: 512,
    errors: 0,
    destinations: [
      {
        id: generateId(),
        channel_id: 2,
        name: "Main EMR",
        type: DestinationType.HL7,
        endpoint: "emr.hospital.local:5001",
        sent: 512,
        errors: 0,
      },
    ],
  },
  {
    id: generateId(),
    name: "Pharmacy Orders (ORM)",
    status: ChannelStatus.ERROR,
    source: { type: "HTTP", endpoint: "/api/orm" },
    received: 256,
    sent: 200,
    errors: 56,
    destinations: [
      {
        id: generateId(),
        channel_id: 3,
        name: "Pharmacy System",
        type: DestinationType.REST,
        endpoint: "https://pharm.hospital.local/api/order",
        sent: 200,
        errors: 56,
      },
    ],
  },
];

// =====================
// MOCK LOGS
// =====================
const generateLog = (channel: Channel, level: LogLevel, message: string, overrides: Partial<LogEntry> = {}): LogEntry => ({
  id: generateId(),
  timestamp: new Date(Date.now() - Math.random() * 100000).toISOString(),
  channelId: channel.id,
  channelName: channel.name,
  level,
  message,
  content: level === LogLevel.ERROR ? `HL7|...|ERROR_SEGMENT|...` : `HL7|...|DATA_SEGMENT|...`,
  error: level === LogLevel.ERROR ? `Connection timed out to ${channel.destinations[0].endpoint}` : undefined,
  ...overrides,
});

export const MOCK_LOGS: LogEntry[] = [
  generateLog(MOCK_CHANNELS[0], LogLevel.INFO, "Message processed successfully."),
  generateLog(MOCK_CHANNELS[0], LogLevel.INFO, "Message processed successfully."),
  generateLog(MOCK_CHANNELS[2], LogLevel.ERROR, `Failed to send to destination 'Pharmacy System'`),
  generateLog(MOCK_CHANNELS[1], LogLevel.DEBUG, "Received message from source."),
  generateLog(MOCK_CHANNELS[0], LogLevel.WARN, "Destination response took longer than 3000ms."),
  generateLog(MOCK_CHANNELS[0], LogLevel.INFO, "Channel script transformed message.", {
    originalPayload: JSON.stringify({ PATIENT_ID: "123", FIRST_NAME: "John", LAST_NAME: "Doe" }, null, 2),
    transformedPayload: JSON.stringify(
      {
        PATIENT_ID: "123",
        FIRST_NAME: "John",
        LAST_NAME: "Doe",
        PATIENT_NAME: "John Doe",
      },
      null,
      2
    ),
  }),
].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

// =====================
// MOCK HISTORICAL LOGS
// =====================
export const MOCK_HISTORICAL_LOGS: LogEntry[] = [
  ...MOCK_LOGS,
  ...Array.from({ length: 100 }, () => {
    const channel = MOCK_CHANNELS[Math.floor(Math.random() * MOCK_CHANNELS.length)];
    const level = [LogLevel.INFO, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR][Math.floor(Math.random() * 4)];
    return generateLog(channel, level, "Historical message processed.");
  }),
].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

// =====================
// MOCK STATS
// =====================
export const MOCK_STATS: MonitorStats = {
  totalReceived: 1792,
  totalSent: 1732,
  totalErrors: 60,
  channelsRunning: 1,
  channelsStopped: 1,
  channelsError: 1,
};
