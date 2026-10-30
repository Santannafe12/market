const TOKEN_KEY = 'market.token';

export type Role = 'SELLER' | 'BIDDER';

export type PublicUser = {
  id: string;
  publicId: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
};

type AuthResponse = {
  accessToken: string;
  user: PublicUser;
};

type ApiErrorBody = {
  code?: string;
  message?: string;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}, authenticated = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (authenticated) {
    const token = getToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const response = await fetch(`${apiUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    let message = 'Não foi possível concluir a operação.';
    let code: string | undefined;
    try {
      const body = (await response.json()) as ApiErrorBody;
      if (body.message) {
        message = body.message;
      }
      code = body.code;
    } catch {
      message = response.statusText || message;
    }
    throw new ApiError(response.status, message, code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function register(input: {
  name: string;
  email: string;
  password: string;
  role: Role;
}) {
  return request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function login(input: { email: string; password: string }) {
  return request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function me() {
  return request<PublicUser>('/api/auth/me', { method: 'GET' }, true);
}

export function roleLabel(role: Role) {
  return role === 'SELLER' ? 'Leiloeiro' : 'Licitante';
}
