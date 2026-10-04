import { api } from './api';
import type { LogEntry } from '../types';
export interface MessageFilters {
  page?: number;
  pageSize?: number;
  channelId?: number;
  direction?: string;
  status?: string;
  statusGroup?: 'errors' | 'pending';
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}
export async function fetchLogPage(params: MessageFilters = {}) {
  const { data } = await api.get('/message', { params });
  return data as {
    data: LogEntry[];
    pagination: { page: number; pageSize: number; total: number };
  };
}
export async function fetchLogs(channelId?: number): Promise<LogEntry[]> {
  return (await fetchLogPage({ channelId })).data;
}
export async function fetchLogDetail(id: number, logPage = 1): Promise<LogEntry> {
  const { data } = await api.get(`/message/${id}`, { params: { logPage } });
  return data.data;
}
export const resendMessage = async (id: number) => {
  const { data } = await api.post(`/message/resend/${id}`);
  return data;
};
