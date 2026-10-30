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

export const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

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

export function me(signal?: AbortSignal) {
  return request<PublicUser>('/api/auth/me', { method: 'GET', signal }, true);
}

export type DisplayStatus = 'live' | 'scheduled' | 'ended' | 'cancelled';

export type PublicAuction = {
  id: string;
  sellerPublicId: string;
  status: 'OPEN' | 'CANCELLED' | 'SETTLED' | 'UNSOLD';
  displayStatus: DisplayStatus;
  startingBidCents: number;
  minIncrementCents: number;
  currentBidCents: number | null;
  currentLeaderPublicId: string | null;
  bidCount: number;
  version: number;
  startsAt: string;
  originalEndsAt: string;
  endsAt: string;
  editionId: string;
  workId: string;
  title: string;
  authors: string[];
  publisher: string | null;
  publishedDate: string | null;
  publishedYear: number | null;
  isbn: string | null;
  language: string | null;
  description: string | null;
  hasCover: boolean;
  serverNow?: string;
};

export type WorkSummary = {
  workId: string;
  title: string;
  authors: string[];
  firstPublishYear: number | null;
};

export type EditionSummary = {
  editionId: string;
  title: string;
  publisher: string | null;
  publishedDate: string | null;
  publishedYear: number | null;
  isbn: string | null;
  language: string | null;
};

export type EditionPreview = EditionSummary & {
  workId: string;
  authors: string[];
  description: string | null;
};

export function listAuctions(status: 'live' | 'scheduled' | 'ended') {
  return request<PublicAuction[]>(`/api/auctions?status=${status}`, { method: 'GET' }, true);
}

export function myAuctions(signal?: AbortSignal) {
  return request<PublicAuction[]>('/api/auctions/mine', { method: 'GET', signal }, true);
}

export function getAuction(id: string, signal?: AbortSignal) {
  return request<PublicAuction & { serverNow: string }>(`/api/auctions/${id}`, { method: 'GET', signal });
}

export function createAuction(input: {
  editionId: string;
  startingBidCents: number;
  minIncrementCents: number;
  startsAt: string;
  endsAt: string;
}) {
  return request<PublicAuction>(
    '/api/auctions',
    { method: 'POST', body: JSON.stringify(input) },
    true,
  );
}

export function cancelAuction(id: string) {
  return request<PublicAuction>(`/api/auctions/${id}/cancel`, { method: 'POST' }, true);
}

export function searchWorks(q: string) {
  return request<WorkSummary[]>(`/api/catalog/search?q=${encodeURIComponent(q)}`, { method: 'GET' }, true);
}

export function workEditions(workId: string) {
  return request<EditionSummary[]>(`/api/catalog/works/${workId}/editions`, { method: 'GET' }, true);
}

export function editionPreview(editionId: string) {
  return request<EditionPreview>(`/api/catalog/editions/${editionId}`, { method: 'GET' }, true);
}

export function coverUrl(id: string) {
  return `${apiUrl}/api/auctions/${id}/cover`;
}

export type WalletView = {
  balanceCents: number;
  committedCents: number;
  availableCents: number;
};

export type PublicBid = {
  sequence: number;
  bidderPublicId: string;
  amountCents: number;
  endsAtAfter: string;
  createdAt: string;
};

export type PlaceBidResult = {
  auction: PublicAuction;
  bid: PublicBid;
  wallet: WalletView;
};

export function getWallet(signal?: AbortSignal) {
  return request<WalletView>('/api/wallet', { method: 'GET', signal }, true);
}

export function deposit(amountCents: number) {
  return request<WalletView>(
    '/api/wallet/deposits',
    { method: 'POST', body: JSON.stringify({ amountCents }) },
    true,
  );
}

export function listBids(auctionId: string, signal?: AbortSignal) {
  return request<PublicBid[]>(`/api/auctions/${auctionId}/bids`, { method: 'GET', signal });
}

export function placeBid(auctionId: string, amountCents: number) {
  return request<PlaceBidResult>(
    `/api/auctions/${auctionId}/bids`,
    { method: 'POST', body: JSON.stringify({ amountCents }) },
    true,
  );
}

export type AuditVerdict = 'INTEGRO' | 'ADULTERADO' | 'INDETERMINADO';

export type AuditFailure = {
  code: string;
  sequence: number | null;
  message: string;
};

export type AuditBid = {
  sequence: number;
  bidderPublicId: string;
  amountCents: number;
  previousHash: string;
  hash: string;
  endsAtAfter: string;
  createdAt: string;
};

export type AuditReport = {
  verdict: AuditVerdict;
  failures: AuditFailure[];
  auction: PublicAuction;
  bids: AuditBid[];
};

export function getAudit(auctionId: string) {
  return request<AuditReport>(`/api/auctions/${auctionId}/audit`);
}

export type ParticipationResult = 'LEADING' | 'OUTBID' | 'WON' | 'LOST' | 'CANCELLED';

export type Participation = {
  result: ParticipationResult;
  receiptToken: string | null;
  auction: PublicAuction;
};

export type PublicReceipt = {
  publicToken: string;
  auctionId: string;
  title: string;
  amountCents: number;
  winnerPublicId: string;
  sellerPublicId: string;
  createdAt: string;
};

export function participations(signal?: AbortSignal) {
  return request<Participation[]>('/api/me/participations', { method: 'GET', signal }, true);
}

export function getReceipt(publicToken: string) {
  return request<PublicReceipt>(`/api/receipts/${encodeURIComponent(publicToken)}`);
}

export function sellerReceived(signal?: AbortSignal) {
  return request<{ receivedCents: number }>('/api/auctions/received', { method: 'GET', signal }, true);
}

export function roleLabel(role: Role) {
  return role === 'SELLER' ? 'Leiloeiro' : 'Licitante';
}
