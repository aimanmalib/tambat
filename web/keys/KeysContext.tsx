import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { BchSigner } from './bch';
import type { NostrSigner } from './nostr';

/** The keys the user connected in this tab, shared by every page. Nothing here is stored. */
interface Keys {
  nostr: NostrSigner | null;
  setNostr: (s: NostrSigner | null) => void;
  bch: BchSigner | null;
  setBch: (s: BchSigner | null) => void;
}

const KeysContext = createContext<Keys | null>(null);

export function KeysProvider({ children }: { children: ReactNode }) {
  const [nostr, setNostr] = useState<NostrSigner | null>(null);
  const [bch, setBch] = useState<BchSigner | null>(null);
  const value = useMemo(() => ({ nostr, setNostr, bch, setBch }), [nostr, bch]);
  return <KeysContext.Provider value={value}>{children}</KeysContext.Provider>;
}

export function useKeys(): Keys {
  const value = useContext(KeysContext);
  if (!value) throw new Error('useKeys outside KeysProvider');
  return value;
}
