import { api } from './api';
import type { Channel, ChannelFormData, ChannelStatus } from '../types';

export const fetchChannels = async (includeArchived = false): Promise<Channel[]> => {
  const { data } = await api.get(
    '/channel',
    includeArchived ? { params: { includeArchived: true } } : undefined,
  );
  return data;
};

export const createChannel = async (payload: ChannelFormData) => {
  const { data } = await api.post('/channel', payload);
  return data;
};

export const updateChannel = async (id: number, payload: ChannelFormData) => {
  const { data } = await api.put(`/channel/${id}`, payload);
  return data;
};

export const updateChannelStatus = async (id: number, status: ChannelStatus) => {
  const { data } = await api.put(`/channel/${id}/status`, { status });
  return data;
};

export const deleteChannel = async (id: number) => {
  const { data } = await api.delete(`/channel/${id}`);
  return data;
};
export const archiveChannel = async (id: number) => api.post(`/channel/${id}/archive`);

export async function rotateSourceCredential(id: number): Promise<string> {
  const { data } = await api.put<{ data: { apiKey: string } }>('/channel/' + id + '/credential');
  return data.data.apiKey;
}
