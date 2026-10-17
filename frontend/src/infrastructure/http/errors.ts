export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public traceId?: string) {
    super(message);
    this.name = "ApiError";
  }
}
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
