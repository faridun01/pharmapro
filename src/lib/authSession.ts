import { User } from '../core/domain';

type LoginResponse = {
  token: string;
  user: User;
};

export const getStoredAuthUser = (): User | null => {
  const saved = window.sessionStorage.getItem('pharmapro_user');
  if (!saved) return null;

  try {
    return JSON.parse(saved) as User;
  } catch {
    return null;
  }
};

export const clearStoredAuthSession = () => {
  window.sessionStorage.removeItem('pharmapro_token');
  window.sessionStorage.removeItem('pharmapro_user');
  window.localStorage.removeItem('pharmapro_token');
};

export const loginWithPassword = async (login: string, password: string): Promise<LoginResponse> => {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || (response.status === 401 ? 'Invalid credentials' : 'Login failed'));
  }

  const data = payload as LoginResponse;
  window.sessionStorage.setItem('pharmapro_token', data.token);
  window.sessionStorage.setItem('pharmapro_user', JSON.stringify(data.user));
  window.localStorage.setItem('pharmapro_token', data.token);
  return data;
};