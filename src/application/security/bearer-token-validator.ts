export class BearerTokenValidator {
  constructor(private readonly expectedToken: string) {}

  validateAuthorizationHeader(value: string | undefined): boolean {
    if (!value) {
      return false;
    }

    const [scheme, token] = value.split(" ");

    if (scheme !== "Bearer") {
      return false;
    }

    return token === this.expectedToken;
  }
}
