import { API_BASE_URL } from './api';
export const checkServerStatus = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${API_BASE_URL}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
};
