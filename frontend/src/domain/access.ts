import type { Session } from "./types";

// Chooses the workspace only. Contract roles still authorize every admin transaction.
export const isAdminEmail = (email?: string | null) => email?.trim().toLowerCase() === "viego.hvnh@gmail.com";
export function isAdminAccount(session: Session | null): boolean {
  return isAdminEmail(session?.user.email);
}
