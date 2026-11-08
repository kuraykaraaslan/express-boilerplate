/**
 * document.31 (storage half): a failure of the storage PROVIDER (its answer could
 * not be parsed, or it failed outright) is tagged, so a caller can tell it from
 * its own bugs and from a client's malformed request. A bare SyntaxError from a
 * provider's truncated or mis-typed answer used to reach the route boundary,
 * which maps every SyntaxError to "400 Malformed request body".
 *
 *   err instanceof StorageProviderError    the class
 *   err.code === 'STORAGE_PROVIDER_PARSE_ERROR' | 'STORAGE_PROVIDER_ERROR'
 *   isStorageProviderError(err)            either of the above, or a raw SyntaxError
 *                                          raised by a storage call (a caller that
 *                                          wraps a storage call may treat it as one)
 *
 * It is a plain Error (not a SyntaxError): unmapped, it is a generic 500.
 */
export type StorageProviderErrorCode = 'STORAGE_PROVIDER_PARSE_ERROR' | 'STORAGE_PROVIDER_ERROR'

export class StorageProviderError extends Error {
  readonly code: StorageProviderErrorCode
  readonly op: string
  constructor(code: StorageProviderErrorCode, op: string, cause?: unknown) {
    super(code === 'STORAGE_PROVIDER_PARSE_ERROR'
      ? `The storage provider answered ${op} with a response that could not be parsed`
      : `The storage provider failed ${op}`)
    this.name = 'StorageProviderError'
    this.code = code
    this.op = op
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause
  }
}

export function isStorageProviderError(err: unknown): boolean {
  return err instanceof StorageProviderError
    || (!!err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string'
      && ((err as { code: string }).code === 'STORAGE_PROVIDER_PARSE_ERROR' || (err as { code: string }).code === 'STORAGE_PROVIDER_ERROR'))
    || err instanceof SyntaxError
}

/** Run one provider call; a parse failure of its answer becomes a tagged StorageProviderError. */
export async function providerCall<T>(op: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof SyntaxError) throw new StorageProviderError('STORAGE_PROVIDER_PARSE_ERROR', op, err)
    throw err
  }
}
