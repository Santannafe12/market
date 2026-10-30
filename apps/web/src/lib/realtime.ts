import { io, type Socket } from 'socket.io-client';
import type { AuctionUpdatedEvent } from '@realtime/auction-sync';
import { apiUrl, getToken } from '@/lib/api';

type AuctionListener = (event: AuctionUpdatedEvent) => void;
type HintListener = () => void;
type VoidListener = () => void;

let socket: Socket | null = null;
let socketToken: string | null = null;
const auctionListeners = new Set<AuctionListener>();
const hintListeners = new Set<HintListener>();
const connectListeners = new Set<VoidListener>();
const disconnectListeners = new Set<VoidListener>();

export function disconnectRealtime() {
  const current = socket;
  socket = null;
  socketToken = null;
  if (!current) {
    return;
  }
  current.removeAllListeners();
  current.disconnect();
}

export function ensureRealtime() {
  const token = getToken();
  if (socket && socketToken === token) {
    return socket;
  }
  disconnectRealtime();
  socketToken = token;
  const next = io(apiUrl || undefined, {
    autoConnect: true,
    transports: ['websocket', 'polling'],
    auth: (callback) => {
      const live = getToken();
      callback(live ? { token: live } : {});
    },
  });
  next.on('auction.updated', (event: AuctionUpdatedEvent) => {
    auctionListeners.forEach((listener) => listener(event));
  });
  next.on('wallet.hint', () => {
    hintListeners.forEach((listener) => listener());
  });
  next.on('connect', () => {
    connectListeners.forEach((listener) => listener());
  });
  next.on('disconnect', () => {
    disconnectListeners.forEach((listener) => listener());
  });
  socket = next;
  return next;
}

export function onAuctionUpdated(listener: AuctionListener) {
  auctionListeners.add(listener);
  return () => auctionListeners.delete(listener);
}

export function onWalletHint(listener: HintListener) {
  hintListeners.add(listener);
  return () => hintListeners.delete(listener);
}

export function onRealtimeConnect(listener: VoidListener) {
  connectListeners.add(listener);
  return () => connectListeners.delete(listener);
}

export function onRealtimeDisconnect(listener: VoidListener) {
  disconnectListeners.add(listener);
  return () => disconnectListeners.delete(listener);
}

export async function joinAuctionRoom(auctionId: string) {
  const current = ensureRealtime();
  if (!current.connected) {
    await waitForConnect(current);
  }
  const ack = (await current.timeout(8_000).emitWithAck('auction.join', { auctionId })) as { ok?: boolean };
  if (!ack?.ok) {
    throw new Error('Não foi possível entrar na sala.');
  }
}

function waitForConnect(current: Socket) {
  if (current.connected) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      current.off('connect', onConnect);
      reject(new Error('Não foi possível conectar à sala.'));
    }, 8_000);
    const onConnect = () => {
      clearTimeout(timer);
      resolve();
    };
    current.once('connect', onConnect);
  });
}
