import { api } from "./api";
import { Channel, ChannelFormData, ChannelStatus } from "../types";

export const fetchChannels = async (): Promise<Channel[]> => {
  const { data } = await api.get("/channel");
  return data;
};

export const createChannel = async (payload: ChannelFormData) => {
  const { data } = await api.post("/channel", payload);
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
