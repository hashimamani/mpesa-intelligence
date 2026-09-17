import type {
  AuthLoginResponseDTO,
  AuthUserDTO,
  StatementDTO,
  StatementWithJobDTO,
  TransactionDTO,
  UploadUrlResponseDTO,
} from "@mpesa/types";
import type { StatementUploadInput } from "@mpesa/validation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include", // sends/receives the httpOnly refresh_token cookie
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Request failed (${res.status})`, res.status, body.issues);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function withAuth(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

export const authApi = {
  register: (email: string, password: string) =>
    apiFetch<{ user: AuthUserDTO }>("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),

  login: (email: string, password: string) =>
    apiFetch<AuthLoginResponseDTO>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  refresh: () => apiFetch<{ accessToken: string }>("/auth/refresh", { method: "POST", body: "{}" }),

  logout: () => apiFetch<void>("/auth/logout", { method: "POST", body: "{}" }),

  verifyEmail: (token: string) =>
    apiFetch<{ verified: true }>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }),

  forgotPassword: (email: string) =>
    apiFetch<{ ok: true }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),

  resetPassword: (token: string, newPassword: string) =>
    apiFetch<{ ok: true }>("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword }) }),

  me: (accessToken: string) => apiFetch<AuthUserDTO>("/auth/me", { headers: withAuth(accessToken) }),
};

export const statementsApi = {
  requestUploadUrl: (accessToken: string, input: StatementUploadInput) =>
    apiFetch<UploadUrlResponseDTO>("/statements/upload-url", {
      method: "POST",
      headers: withAuth(accessToken),
      body: JSON.stringify(input),
    }),

  /** PUTs directly to storage — never through the API server. See docs/13-auth-architecture.md's
   * pattern, applied here to files: the API only ever hands out a scoped, short-lived URL. */
  uploadToStorage: async (uploadUrl: string, file: File): Promise<void> => {
    const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (!res.ok) throw new ApiError("Upload to storage failed", res.status);
  },

  confirm: (accessToken: string, statementId: string) =>
    apiFetch<StatementWithJobDTO>(`/statements/${statementId}/confirm`, {
      method: "POST",
      headers: withAuth(accessToken),
    }),

  get: (accessToken: string, statementId: string) =>
    apiFetch<StatementWithJobDTO>(`/statements/${statementId}`, { headers: withAuth(accessToken) }),

  list: (accessToken: string) => apiFetch<StatementDTO[]>("/statements", { headers: withAuth(accessToken) }),

  listTransactions: (accessToken: string, statementId: string) =>
    apiFetch<TransactionDTO[]>(`/statements/${statementId}/transactions`, { headers: withAuth(accessToken) }),
};
