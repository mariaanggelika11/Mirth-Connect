import { api } from './api';
export async function fetchHL7Tree(message: string) {
  const { data } = await api.post('/hl7/parse', { message });
  return data;
}
