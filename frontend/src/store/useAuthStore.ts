import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { AuthSession, UserRole } from "@/types";

interface AuthState {
  token?: string;
  role?: UserRole;
  phone?: string;
  userId?: number;
  expireAt?: string | null;
  setAuth: (session: AuthSession) => void;
  setRole: (role: UserRole, expireAt?: string | null) => void;
  reset: () => void;
}

type AuthPersistedState = Pick<AuthState, "token" | "role" | "phone" | "userId" | "expireAt">;

const STORAGE_KEY = "robotcloud-auth";

const createStorage = () =>
  createJSONStorage<AuthPersistedState>(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    const memoryStorage: Record<string, string> = {};
    return {
      getItem: (name: string) => memoryStorage[name] ?? null,
      setItem: (name: string, value: string) => {
        memoryStorage[name] = value;
      },
      removeItem: (name: string) => {
        delete memoryStorage[name];
      },
      clear: () => {
        for (const key of Object.keys(memoryStorage)) {
          delete memoryStorage[key];
        }
      },
      key: (index: number) => Object.keys(memoryStorage)[index] ?? null,
      get length() {
        return Object.keys(memoryStorage).length;
      }
    };
  });

const initialState = (): AuthPersistedState => ({
  token: undefined,
  role: undefined,
  phone: undefined,
  userId: undefined,
  expireAt: undefined
});

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      ...initialState(),
      setAuth: (session) =>
        set({
          token: session.token,
          role: session.role,
          phone: session.phone,
          userId: session.userId,
          expireAt: session.expireAt
        }),
      setRole: (role, expireAt) =>
        set((state) => ({
          ...state,
          role,
          expireAt: expireAt ?? state.expireAt
        })),
      reset: () => {
        set(initialState());
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      }
    }),
    {
      name: STORAGE_KEY,
      storage: createStorage(),
      partialize: (state) => ({
        token: state.token,
        role: state.role,
        phone: state.phone,
        userId: state.userId,
        expireAt: state.expireAt
      })
    }
  )
);
