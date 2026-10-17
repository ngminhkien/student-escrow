export function feedbackMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Không thể hoàn tất thao tác. Vui lòng thử lại.";
}
