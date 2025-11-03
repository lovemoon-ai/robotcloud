import { create } from "zustand";
import { AuthSession, UserRole } from "@/types";

interface AuthState {
  token?: string;
  role?: UserRole;
  phone?: string;
  userId?: number;
  expireAt?: string | null;
  setAuth: (session: AuthSession) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: undefined,
  role: undefined,
  phone: undefined,
  userId: undefined,
  expireAt: undefined,
  setAuth: (session) =>
    set({
      token: session.token,
      role: session.role,
      phone: session.phone,
      userId: session.userId,
      expireAt: session.expireAt
    }),
  reset: () =>
    set({
      token: undefined,
      role: undefined,
      phone: undefined,
      userId: undefined,
      expireAt: undefined
    })
}));
