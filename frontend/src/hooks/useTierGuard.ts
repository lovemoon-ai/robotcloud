import { useAuthStore } from "@/store/useAuthStore";
import { UserTier } from "@/types";

const tierRank: Record<UserTier, number> = {
  free: 0,
  plus: 1,
  pro: 2
};

export function useTierGuard(required: UserTier) {
  const tier = useAuthStore((state) => state.tier ?? "free");
  return tierRank[tier] >= tierRank[required];
}
