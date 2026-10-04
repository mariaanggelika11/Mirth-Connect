export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function safeError(error: unknown): string {
  if (error instanceof AppError) return error.code;
  // Script and remote error messages may contain PHI. Persist a diagnostic code only.
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{1,50}$/.test(error.code)
  )
    return error.code;
  return 'PROCESSING_ERROR';
}
