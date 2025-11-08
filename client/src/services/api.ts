import axios from "axios";
import { Channel, ChannelFormData, ChannelStatus, LogEntry, MonitorStats } from "../types";
import { MOCK_LOGS, MOCK_HISTORICAL_LOGS, MOCK_STATS } from "./mockData";

const API_DELAY = 500;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:9000";

const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  headers: { "Content-Type": "application/json" },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ====================================================
// HEALTH CHECK
// ====================================================
export const checkServerStatus = async (): Promise<{ status: string }> => {
  try {
    await api.get("/health");
    return { status: "ok" };
  } catch {
    throw new Error("Failed to connect to server");
  }
};

// ====================================================
// CHANNEL API
// ====================================================
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

// ====================================================
// DESTINATION API
// ====================================================

/**
 * Kirim payload hasil transform ke semua destination channel
 * @param channelId ID channel
 * @param messageId ID pesan dari tabel Messages
 * @param payload Payload hasil transformasi
 */
export const sendToDestinations = async (channelId: number, messageId: number, payload: object): Promise<{ message: string; results: any[] }> => {
  const { data } = await api.post("/destination/send", { channelId, messageId, payload });
  return data;
};

/**
 * Ambil log pengiriman per message
 * @param messageId ID pesan
 */
export const fetchDestinationLogs = async (
  messageId: number
): Promise<
  {
    id: number;
    destination_name: string;
    status: string;
    response_text: string;
    sent_at: string;
  }[]
> => {
  const { data } = await api.get(`/destination/log/${messageId}`);
  return data;
};

// ====================================================
// FILE UPLOAD
// ====================================================
export const uploadXmlConfig = async (file: File): Promise<{ message: string }> => {
  const formData = new FormData();
  formData.append("file", file);

  const res = await api.post("/upload/xml", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
};

// ====================================================
// MONITORING & LOGS (sementara mock)
// ====================================================
// ====================================================
// MONITORING & LOGS (sementara mock)
// ====================================================
/**
 * Ambil log pesan dari backend
 * @param channelId (opsional) filter berdasarkan channel ID
 */
export const fetchLogs = async (channelId?: number): Promise<LogEntry[]> => {
  const { data } = await api.get("/message", { params: { channelId } });

  return data.map((msg: any) => ({
    id: msg.id,
    channelId: msg.channel_id,
    channelName: msg.channel_name || `Channel ${msg.channel_id}`, // ✅ fallback
    timestamp: msg.created_at,
    level: msg.status === "ERROR" ? "ERROR" : "INFO",
    message: `${msg.direction} - ${msg.status}`,
    originalPayload: msg.original_payload ? JSON.parse(msg.original_payload) : {},
    transformedPayload: msg.transformed_payload ? JSON.parse(msg.transformed_payload) : {},
    error: msg.error_detail,
  }));
};

export const fetchHistoricalLogs = async (): Promise<LogEntry[]> => {
  await sleep(API_DELAY);
  return JSON.parse(JSON.stringify(MOCK_HISTORICAL_LOGS));
};

/**
 * Ambil statistik total dari backend
 */
export const fetchMonitorStats = async (): Promise<MonitorStats> => {
  const { data } = await api.get("/message/stats");
  return {
    totalReceived: data.totalReceived || 0,
    totalSent: data.totalSent || 0,
    totalErrors: data.totalErrors || 0,
    channelsRunning: 0, // nanti bisa dihitung dari /api/channel
    channelsStopped: 0,
    channelsError: 0,
  };
};
export const resendMessage = async (logId: number): Promise<{ message: string }> => {
  await sleep(API_DELAY);
  return { message: `Message from log ${logId} has been successfully resent.` };
};

// ====================================================
// AUTHENTICATION
// ====================================================
export const login = async (username: string, password: string): Promise<{ token: string }> => {
  const { data } = await api.post("/auth/login", { username, password });
  return { token: data.data?.token || data.token };
};
