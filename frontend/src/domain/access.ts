import type { Session } from "./types";

// Chooses the workspace only. Contract roles still authorize every admin transaction.
export function isAdminAccount(session: Session | null): boolean {
  return session?.user.email.trim().toLowerCase() === "viego.hvnh@gmail.com";
}
