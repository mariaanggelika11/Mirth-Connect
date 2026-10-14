import { api, API_BASE_URL } from './api';
import type { User } from '../types';
export interface AuditEntry {
  id: number;
  action: string;
  resource_type: string;
  resource_id: number;
  created_at: string;
  user_id: number | null;
}
export interface CreateUserInput {
  username: string;
  name: string;
  password: string;
  role: string;
}
export async function fetchUsers(page: number): Promise<User[]> {
  const { data } = await api.get<{ data: User[] }>('/users', { params: { page } });
  return data.data;
}
export async function fetchAudit(page: number): Promise<AuditEntry[]> {
  const { data } = await api.get<{ data: AuditEntry[] }>('/audit', { params: { page } });
  return data.data;
}
export async function createUser(input: CreateUserInput): Promise<void> {
  await api.post('/users', input);
}
export async function updateUserRole(id: number, role: string): Promise<void> {
  await api.put('/users/' + id + '/role', { role });
}
export async function checkReadiness(): Promise<void> {
  await api.get(API_BASE_URL + '/ready', { baseURL: '' });
}
