import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BchSigner } from './bch';
import type { NostrSigner } from './nostr';

/** The keys the user connected in this tab, shared by every page. Nothing here is stored. */
interface Keys {
  nostr: NostrSigner | null;
  setNostr: (s: NostrSigner | null) => void;
  bch: BchSigner | null;
  setBch: (s: BchSigner | null) => void;
  /** True after the connected wallet ended its WalletConnect session, until another BCH key is picked. */
  bchEnded: boolean;
}

const KeysContext = createContext<Keys | null>(null);

export function KeysProvider({ children }: { children: ReactNode }) {
  const [nostr, setNostr] = useState<NostrSigner | null>(null);
  const [bch, setBchState] = useState<BchSigner | null>(null);
  const [bchEnded, setBchEnded] = useState(false);
  const setBch = useCallback((s: BchSigner | null) => {
    setBchEnded(false);
    setBchState(s);
  }, []);
  // A wallet that disconnects after it connected: forget it, so the page offers Connect again and says why.
  useEffect(() => {
    let current = true;
    bch?.onEnd?.(() => {
      if (!current) return;
      setBchState(null);
      setBchEnded(true);
    });
    return () => {
      current = false;
    };
  }, [bch]);
  const value = useMemo(() => ({ nostr, setNostr, bch, setBch, bchEnded }), [nostr, bch, setBch, bchEnded]);
  return <KeysContext.Provider value={value}>{children}</KeysContext.Provider>;
}

export function useKeys(): Keys {
  const value = useContext(KeysContext);
  if (!value) throw new Error('useKeys outside KeysProvider');
  return value;
}
