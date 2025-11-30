import { api } from "./api";

export const sendToDestinations = async (channelId: number, messageId: number, payload: object) => {
  const { data } = await api.post("/destination/send", {
    channelId,
    messageId,
    payload,
  });
  return data;
};

export const fetchDestinationLogs = async (messageId: number) => {
  const { data } = await api.get(`/destination/log/${messageId}`);

  return data.map((d: any) => ({
    id: d.id,
    destinationName: d.destination_name,
    status: d.status,
    responseText: d.response_text,
    requestData: safelyParse(d.request_data),
    outboundData: safelyParse(d.outbound_data),
    sentAt: d.sent_at,
  }));
};

function safelyParse(v: any) {
  try {
    return typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return v;
  }
}
