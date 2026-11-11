export const queryKeys = {
  all: ["stacklet"] as const,
  summary: (month: string) => ["stacklet", "summary", month] as const,
  cash: ["stacklet", "cash"] as const,
  transactions: (type: string, q: string) =>
    ["stacklet", "transactions", type, q] as const,
  goal: ["stacklet", "goal"] as const,
};
