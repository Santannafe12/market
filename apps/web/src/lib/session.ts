import { QueryClient } from '@tanstack/react-query';
import { clearToken, setToken } from '@/lib/api';
import { disconnectRealtime } from '@/lib/realtime';

const privateKeys = [
  ['me'],
  ['wallet'],
  ['participations'],
  ['auctions', 'mine'],
  ['auctions', 'received'],
] as const;

function isPrivateQuery(queryKey: readonly unknown[]) {
  return privateKeys.some((expected) => expected.every((part, index) => queryKey[index] === part));
}

export async function discardPrivateCache(queryClient: QueryClient, keepMe = false) {
  disconnectRealtime();
  const predicate = (query: { queryKey: readonly unknown[] }) =>
    isPrivateQuery(query.queryKey) && !(keepMe && query.queryKey[0] === 'me');
  await queryClient.cancelQueries({ predicate });
  queryClient.removeQueries({ predicate });
}

export async function adoptSession(queryClient: QueryClient, token: string) {
  await discardPrivateCache(queryClient);
  setToken(token);
}

export async function endSession(queryClient: QueryClient) {
  await discardPrivateCache(queryClient);
  clearToken();
}

export function safeLotPath(state: unknown) {
  if (!state || typeof state !== 'object' || !('from' in state)) {
    return '/';
  }
  const from = (state as { from?: unknown }).from;
  if (typeof from !== 'string' || !from.startsWith('/lotes/')) {
    return '/';
  }
  return from;
}
