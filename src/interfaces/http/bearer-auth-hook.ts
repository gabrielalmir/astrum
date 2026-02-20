import type { preHandlerHookHandler } from "fastify";
import { BearerTokenValidator } from "../../application/security/bearer-token-validator.js";

export function createBearerAuthHook(
  tokenValidator: BearerTokenValidator,
): preHandlerHookHandler {
  return async (request, reply) => {
    const authorized = tokenValidator.validateAuthorizationHeader(
      request.headers.authorization,
    );

    if (authorized) {
      return;
    }

    return reply
      .code(401)
      .header("WWW-Authenticate", 'Bearer realm="astrum"')
      .send({ error: "Unauthorized." });
  };
}
