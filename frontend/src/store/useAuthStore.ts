import { create } from "zustand";
import { AuthResponse, UserTier } from "@/types";

interface AuthState {
  token?: string;
  tier?: UserTier;
  name?: string;
  setAuth: (response: AuthResponse) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: undefined,
  tier: undefined,
  name: undefined,
  setAuth: (response) =>
    set({
      token: response.token,
      tier: response.user.tier,
      name: response.user.name
    }),
  reset: () => set({ token: undefined, tier: undefined, name: undefined })
}));
