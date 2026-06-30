import { useAuthStore } from "@/store/useAuthStore";
import { UserRole } from "@/types";

const roleRank: Record<UserRole, number> = {
  free: 0,
  plus: 1,
  pro: 2,
  admin: 3
};

export function useTierGuard(required: UserRole) {
  const role = useAuthStore((state) => state.role ?? "free");
  return roleRank[role] >= roleRank[required];
}
