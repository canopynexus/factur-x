export class FacturXError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FacturXError';
  }
}

export class FacturXValidationError extends FacturXError {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];

  constructor(errors: readonly string[], warnings: readonly string[] = []) {
    super(`Invoice is not valid:\n- ${errors.join('\n- ')}`);
    this.name = 'FacturXValidationError';
    this.errors = errors;
    this.warnings = warnings;
  }
}
