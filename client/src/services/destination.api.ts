import { api } from './api';

export const fetchDestinationLogs = async (messageId: number) => {
  const { data } = await api.get(`/destination/log/${messageId}`);

  return data.map(
    (d: {
      id: number;
      destination_name: string;
      status: string;
      response_text: string;
      request_data: unknown;
      outbound_data: unknown;
      sent_at: string;
    }) => ({
      id: d.id,
      destinationName: d.destination_name,
      status: d.status,
      responseText: d.response_text,
      requestData: safelyParse(d.request_data),
      outboundData: safelyParse(d.outbound_data),
      sentAt: d.sent_at,
    }),
  );
};

function safelyParse(v: unknown) {
  try {
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch {
    return v;
  }
}
