import { useState } from 'react';

const STORAGE_KEY = 'skytalk_tutor_token';

export function getStoredToken(): string | null {
  return sessionStorage.getItem(STORAGE_KEY);
}

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(STORAGE_KEY));

  async function login(password: string): Promise<{ ok: true } | { ok: false; message: string }> {
    let res: Response;
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
    } catch {
      return { ok: false, message: 'Network error. Check your connection.' };
    }

    if (res.status === 401) {
      return { ok: false, message: 'Wrong password. Try again.' };
    }
    if (!res.ok) {
      return { ok: false, message: `Server error (${res.status}). Try again.` };
    }

    const data = (await res.json()) as { tutor_session_token: string };
    sessionStorage.setItem(STORAGE_KEY, data.tutor_session_token);
    setToken(data.tutor_session_token);
    return { ok: true };
  }

  function logout() {
    sessionStorage.removeItem(STORAGE_KEY);
    setToken(null);
  }

  return { token, login, logout };
}
