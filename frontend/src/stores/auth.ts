import { create } from "zustand";
import {
  api,
  getStoredUser,
  LoginResponse,
  logoutSession,
  persistSession,
  PortalUser,
  restoreSession,
} from "../api/client";

type AuthState = {
  user: PortalUser | null;
  loading: boolean;
  bootstrapped: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
};

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: false,
  bootstrapped: false,
  restoreSession: async () => {
    set({ loading: true });
    try {
      const user = await restoreSession();
      set({ user });
    } catch {
      // Keep cached identity on unexpected bootstrap errors; do not force logout.
      set({ user: getStoredUser() });
    } finally {
      set({ loading: false, bootstrapped: true });
    }
  },
  login: async (email, password) => {
    set({ loading: true });
    try {
      const res = await api<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      persistSession({
        access_token: res.access_token,
        refresh_token: res.refresh_token,
        expires_in: res.expires_in,
        user: res.user,
      });
      set({ user: res.user, bootstrapped: true });
    } finally {
      set({ loading: false });
    }
  },
  logout: async () => {
    await logoutSession();
    set({ user: null });
  },
}));

/** Sync read for initial render before bootstrap completes. */
export function readCachedUser(): PortalUser | null {
  return getStoredUser();
}
