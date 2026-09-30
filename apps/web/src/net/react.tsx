import { type ReactNode, createContext, use, useSyncExternalStore } from 'react';
import type { ClientState, PokerClient } from './client';

const ClientContext = createContext<PokerClient | null>(null);

export function ClientProvider({ client, children }: { client: PokerClient; children: ReactNode }) {
  return <ClientContext value={client}>{children}</ClientContext>;
}

export function useClient(): PokerClient {
  const client = use(ClientContext);
  if (client === null) throw new Error('useClient потребує ClientProvider');
  return client;
}

export function useClientState(): ClientState {
  const client = useClient();
  return useSyncExternalStore(client.subscribe, client.getState);
}
