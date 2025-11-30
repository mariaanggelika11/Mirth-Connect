import { api } from "./api";
import { LogEntry } from "../types";

export const fetchLogs = async (channelId?: number): Promise<LogEntry[]> => {
  const { data } = await api.get("/message", { params: { channelId } });

  return data.map((msg: any) => ({
    id: msg.id,
    channelId: msg.channelId,
    channelName: msg.channelName,
    timestamp: msg.timestamp,
    direction: msg.direction,
    status: msg.status?.toUpperCase(),
    level: msg.level || "INFO",
    message: `${msg.direction} - ${msg.status}`,
    originalPayload: msg.originalPayload,
    transformedPayload: msg.transformedPayload,
    destinationLogs: msg.destinationLogs || [],
  }));
};

export const resendMessage = async (id: number) => {
  const { data } = await api.post(`/message/resend/${id}`);
  return data;
};
