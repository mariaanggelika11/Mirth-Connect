import { api } from './api';
import { MonitorStats } from '../types';

export const fetchMonitorStats = async (): Promise<MonitorStats> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data } = await api.get('/message/stats', { params: { dateFrom: today.toISOString() } });

  return {
    totalReceived: data.totalReceived || 0,
    totalSent: data.totalSent || 0,
    totalErrors: data.totalErrors || 0,
    channelsRunning: data.channelsRunning || 0,
    channelsStopped: data.channelsStopped || 0,
    channelsError: data.channelsError || 0,
    messagesToday: data.messagesToday || 0,
    queuedMessages: data.queuedMessages || 0,
    deadLetterMessages: data.deadLetterMessages || 0,
  };
};
