export type ApiError = {
  code: string;
  message: string;
  requestId?: string;
  details?: string[];
  verificationToken?: string;
};

export class ApiRequestError extends Error {
  code: string;
  details?: string[];
  requestId?: string;
  verificationToken?: string;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.code = error.code;
    this.details = error.details;
    this.requestId = error.requestId;
    this.verificationToken = error.verificationToken;
  }
}

export type ApiResponse<T> = {
  data?: T;
  error?: ApiError;
};

const STORAGE_KEY = 'helix_session';
const DEFAULT_BASE_URL = 'http://localhost:3001';

function getBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
}

export function getStoredSessionToken() {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as { token?: string | null };
    return session.token ?? null;
  } catch {
    return null;
  }
}

export function setStoredSessionToken(token: string | null) {
  if (typeof window === 'undefined') return;

  if (!token) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ token }));
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(isFormData ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  });

  const body = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    const error = body?.error ?? {
      code: 'REQUEST_FAILED',
      message: 'Request failed',
    };
    throw new ApiRequestError({
      code: error.code ?? 'REQUEST_FAILED',
      message: error.message ?? 'Request failed',
      requestId: error.requestId,
      details: error.details,
      verificationToken: error.verificationToken,
    });
  }

  return body as T;
}

export async function getHealth() {
  return apiRequest<{ ok: boolean; service: string; status: string; environment: string; timestamp: string }>(
    '/api/v1/health',
    { method: 'GET' },
  );
}

export async function registerUser(payload: { name: string; email: string; password: string }) {
  return apiRequest<{
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    verificationEmailSent: boolean;
    verificationToken?: string;
    message: string;
  }>(
    '/api/v1/auth/register',
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export async function loginUser(payload: { email: string; password: string; rememberMe?: boolean }) {
  return apiRequest<{ token: string; user: { id: string; name: string; email: string }; expiresAt: string; rememberMe: boolean }>(
    '/api/v1/auth/login',
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export async function createProject(payload: { name: string; description?: string; keyFeatures?: string[]; techStack?: string[] }, token: string) {
  return apiRequest<{ id: string; name: string; description: string; keyFeatures: string[]; techStack: string[]; status: string; progress: number; ownerId: string; createdAt: string }>(
    '/api/v1/projects',
    {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
}

export type ProjectAnalysis = {
  name: string;
  description: string;
  keyFeatures: string[];
  techStack: string[];
};

export async function analyzeProject(payload: {
  name: string;
  description: string;
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
}, token: string) {
  return apiRequest<ProjectAnalysis>('/api/v1/projects/analyze', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function sendVoiceTurn(payload: {
  name: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}, token: string) {
  return apiRequest<{ reply: string }>('/api/v1/voice/turn', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function transcribeVoiceNote(file: Blob, token: string) {
  const formData = new FormData();
  formData.append('audio', file, 'voice-note.webm');

  return apiRequest<{ transcript: string }>('/api/v1/voice/transcribe', {
    method: 'POST',
    body: formData,
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function extractProjectDocument(file: File, token: string) {
  const formData = new FormData();
  formData.append('file', file);

  return apiRequest<{ fileName: string; description: string; truncated: boolean }>('/api/v1/projects/extract-document', {
    method: 'POST',
    body: formData,
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function deleteProject(projectId: string, token: string) {
  return apiRequest<{ message: string; id: string }>(`/api/v1/projects/${projectId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function listProjects(token: string) {
  return apiRequest<Array<{ id: string; name: string; description: string; status: string; progress: number; ownerId: string; createdAt: string }>>(
    '/api/v1/projects',
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
}

export async function getDashboard(token: string) {
  return apiRequest<{
    user: { id: string; name: string; email: string };
    projects: Array<{
      id: string;
      name: string;
      description: string;
      status: string;
      progress: number;
      ownerId: string;
      createdAt: string;
    }>;
    stats: {
      projects: number;
      activeProjects: number;
      completedProjects: number;
      deployments: number;
    };
  }>('/api/v1/dashboard', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function initiateGoogleOAuth() {
  const codeVerifier = generateRandomString(128);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  
  window.localStorage.setItem('google_pkce_verifier', codeVerifier);
  
  const params = new URLSearchParams({
    client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID || 'demo-client-id',
    redirect_uri: `${window.location.origin}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid profile email',
    state: generateRandomString(32),
  });
  
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function initiateGitHubOAuth() {
  const state = generateRandomString(32);
  window.localStorage.setItem('github_oauth_state', state);
  
  const params = new URLSearchParams({
    client_id: import.meta.env.VITE_GITHUB_CLIENT_ID || 'demo-client-id',
    redirect_uri: `${window.location.origin}/auth/github/callback`,
    scope: 'user:email',
    state,
  });
  
  window.location.href = `https://github.com/login/oauth/authorize?${params}`;
}

export async function completeGoogleOAuth(code: string) {
  const codeVerifier = window.localStorage.getItem('google_pkce_verifier');
  window.localStorage.removeItem('google_pkce_verifier');
  
  return apiRequest<{ token: string; user: { id: string; name: string; email: string }; expiresAt: string }>(
    '/api/v1/auth/google/callback',
    {
      method: 'POST',
      body: JSON.stringify({
        code,
        codeVerifier,
        redirectUri: `${window.location.origin}/auth/google/callback`,
      }),
    },
  );
}

export async function completeGitHubOAuth(code: string, state: string) {
  const savedState = window.localStorage.getItem('github_oauth_state');
  window.localStorage.removeItem('github_oauth_state');
  
  if (savedState !== state) {
    throw new Error('OAuth state mismatch');
  }
  
  return apiRequest<{ token: string; user: { id: string; name: string; email: string }; expiresAt: string }>(
    '/api/v1/auth/github/callback',
    {
      method: 'POST',
      body: JSON.stringify({
        code,
        redirectUri: `${window.location.origin}/auth/github/callback`,
      }),
    },
  );
}

export async function requestPasswordReset(email: string) {
  return apiRequest<{ message: string }>(
    '/api/v1/auth/password-reset/request',
    {
      method: 'POST',
      body: JSON.stringify({ email }),
    },
  );
}

export async function resetPassword(token: string, password: string) {
  return apiRequest<{ message: string }>(
    '/api/v1/auth/password-reset/complete',
    {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    },
  );
}

export async function verifyEmail(token: string) {
  return apiRequest<{ message: string; user: { id: string; name: string; email: string; emailVerified: boolean } }>(
    '/api/v1/auth/verify-email',
    {
      method: 'POST',
      body: JSON.stringify({ token }),
    },
  );
}

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(digest))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Password validation utilities
export type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong';

export interface PasswordValidation {
  isValid: boolean;
  errors: string[];
  strength: PasswordStrength;
}

export function validatePasswordComplexity(password: string): PasswordValidation {
  const errors: string[] = [];

  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character (!@#$%^&*...)');
  }

  return {
    isValid: errors.length === 0,
    errors,
    strength: calculatePasswordStrength(password),
  };
}

function calculatePasswordStrength(password: string): PasswordStrength {
  let strength = 0;

  if (password.length >= 8) strength++;
  if (password.length >= 12) strength++;
  if (password.length >= 16) strength++;
  if (/[a-z]/.test(password)) strength++;
  if (/[A-Z]/.test(password)) strength++;
  if (/[0-9]/.test(password)) strength++;
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) strength++;

  if (strength <= 2) return 'weak';
  if (strength <= 4) return 'fair';
  if (strength <= 5) return 'good';
  return 'strong';
}
