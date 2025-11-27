import axios from "axios";
import { Channel, ChannelFormData, ChannelStatus, LogEntry, MonitorStats } from "../types";
import { MOCK_LOGS, MOCK_HISTORICAL_LOGS } from "./mockData";

const API_DELAY = 500;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:9000";

const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  headers: { "Content-Type": "application/json" },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ====================================================
   CHANNEL API
==================================================== */
export const fetchChannels = async (): Promise<Channel[]> => {
  const { data } = await api.get("/channel");
  return data;
};

export const createChannel = async (data: ChannelFormData) => {
  const res = await api.post("/channel", data);
  return res.data;
};

export const updateChannel = async (id: number, data: ChannelFormData) => {
  const res = await api.put(`/channel/${id}`, data);
  return res.data;
};

export const deleteChannel = async (id: number) => {
  const res = await api.delete(`/channel/${id}`);
  return res.data;
};

export const updateChannelStatus = async (id: number, status: ChannelStatus): Promise<{ message: string }> => {
  const res = await api.put(`/channel/${id}/status`, { status });
  return res.data;
};

/* ====================================================
   DESTINATION API
==================================================== */
export const sendToDestinations = async (channelId: number, messageId: number, payload: object): Promise<{ message: string; results: any[] }> => {
  const { data } = await api.post("/destination/send", { channelId, messageId, payload });
  return data;
};

export const fetchDestinationLogs = async (messageId: number) => {
  const { data } = await api.get(`/destination/log/${messageId}`);

  return data.map((d: any) => ({
    id: d.id,
    destinationName: d.destination_name,
    status: d.status,
    responseText: d.response_text,
    requestData: safeParse(d.request_data),
    outboundData: safeParse(d.outbound_data),
    sentAt: d.sent_at,
  }));
};

function safeParse(v: any) {
  try {
    return typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return v;
  }
}

/* ====================================================
   FILE UPLOAD
==================================================== */
export const uploadXmlConfig = async (file: File): Promise<{ message: string }> => {
  const formData = new FormData();
  formData.append("file", file);

  const res = await api.post("/upload/xml", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
};

export const fetchLogs = async (channelId?: number): Promise<LogEntry[]> => {
  const { data } = await api.get("/message", { params: { channelId } });

  return data.map((msg: any) => ({
    id: msg.id,

    // ✔ sesuai backend
    channelId: msg.channelId,
    channelName: msg.channelName,

    // ✔ pakai timestamp baru
    timestamp: msg.timestamp,

    direction: msg.direction,
    status: msg.status?.toUpperCase() || "UNKNOWN",
    level: msg.level || "INFO",

    message: `${msg.direction || "UNKNOWN"} - ${msg.status || "UNKNOWN"}`,

    // ✔ sesuai backend
    originalPayload: msg.originalPayload,
    transformedPayload: msg.transformedPayload,

    destinationLogs: (msg.destinationLogs || []).map((d: any) => ({
      destinationName: d.destinationName,
      status: d.status,
      requestData: d.requestData,
      outboundData: d.outboundData,
      responseText: d.responseText,
      sentAt: d.sentAt,
    })),
  }));
};

export const fetchHistoricalLogs = async (): Promise<LogEntry[]> => {
  await sleep(API_DELAY);
  return JSON.parse(JSON.stringify(MOCK_HISTORICAL_LOGS));
};

export const fetchMonitorStats = async (): Promise<MonitorStats> => {
  const { data } = await api.get("/message/stats");
  return {
    totalReceived: data.totalReceived || 0,
    totalSent: data.totalSent || 0,
    totalErrors: data.totalErrors || 0,
    channelsRunning: 0,
    channelsStopped: 0,
    channelsError: 0,
  };
};

/* ====================================================
   AUTH
==================================================== */
export const login = async (username: string, password: string): Promise<{ token: string }> => {
  const { data } = await api.post("/auth/login", { username, password });
  return { token: data.data?.token || data.token };
};

/* ====================================================
   RESEND OUTBOUND
==================================================== */
export async function resendMessage(id: number) {
  const { data } = await api.post(`/message/resend/${id}`);
  return data;
}
