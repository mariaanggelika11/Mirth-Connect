import { api } from "./api";
import { MonitorStats } from "../types";

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
