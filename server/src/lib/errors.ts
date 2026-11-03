/** An error with an HTTP status that is safe to show to the client. */
export class AppError extends Error {
  constructor(public statusCode: number, message: string, public code = 'ERROR') {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, `${what} not found`, 'NOT_FOUND');
export const conflict = (msg: string) => new AppError(409, msg, 'CONFLICT');
export const badRequest = (msg: string) => new AppError(400, msg, 'BAD_REQUEST');

/** True for SQLite UNIQUE/CHECK/FK violations. */
export const isConstraint = (e: unknown) =>
  typeof e === 'object' && e !== null && String((e as { code?: string }).code).startsWith('SQLITE_CONSTRAINT');
