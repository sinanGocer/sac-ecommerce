export class IyzicoPaymentError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "IyzicoPaymentError"
  }
}

export function fail(code: string, message: string): never {
  throw new IyzicoPaymentError(code, message)
}
