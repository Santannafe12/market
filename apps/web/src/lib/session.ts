import { QueryClient } from '@tanstack/react-query';
import { setToken } from '@/lib/api';

export async function adoptSession(queryClient: QueryClient, token: string) {
  await queryClient.cancelQueries({ queryKey: ['me'] });
  queryClient.removeQueries({ queryKey: ['me'] });
  setToken(token);
}
