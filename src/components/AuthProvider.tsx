"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { firebase, firebaseEnabled } from "@/lib/firebase/client";
import { log } from "@/lib/log";
import SignInSheet from "./SignInSheet";

type SignInRequest = {
  /** Shown at the top of the sheet, e.g. "Sign in to save this coin". */
  reason?: string;
  /** Runs once the user is signed in. */
  onDone?: () => void;
};

type AuthContextValue = {
  /** False when the deployment has no Firebase config; account UI is hidden. */
  enabled: boolean;
  user: User | null;
  /** True until Firebase reports the initial auth state. */
  loading: boolean;
  openSignIn: (req?: SignInRequest) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  enabled: false,
  user: null,
  loading: false,
  openSignIn: () => {},
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(firebaseEnabled);
  const [request, setRequest] = useState<SignInRequest | null>(null);
  const pendingDone = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!firebaseEnabled) {
      log.info("auth", "Accounts disabled: no Firebase config in this build");
      return;
    }
    const { auth } = firebase();
    return onAuthStateChanged(
      auth,
      (u) => {
        setUser(u);
        setLoading(false);
        log.info("auth", u ? "Signed in" : "Signed out", u ? { uid: u.uid, provider: u.providerData[0]?.providerId } : undefined);
        if (u && pendingDone.current) {
          const done = pendingDone.current;
          pendingDone.current = null;
          setRequest(null);
          done();
        }
      },
      (e) => {
        log.error("auth", "Auth listener failed", e);
        setLoading(false);
      },
    );
  }, []);

  const openSignIn = useCallback((req: SignInRequest = {}) => {
    pendingDone.current = req.onDone ?? null;
    setRequest(req);
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(firebase().auth);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ enabled: firebaseEnabled, user, loading, openSignIn, signOut }),
    [user, loading, openSignIn, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {request && (
        <SignInSheet
          reason={request.reason}
          onClose={() => {
            pendingDone.current = null;
            setRequest(null);
          }}
        />
      )}
    </AuthContext.Provider>
  );
}
