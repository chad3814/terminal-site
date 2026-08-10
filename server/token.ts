import { randomBytes } from "node:crypto";

const BOOT_TOKEN_KEY = Symbol.for("terminal-site.boot-token");

type TokenHolder = { [BOOT_TOKEN_KEY]?: string };

export function bootToken(): string {
  const holder = globalThis as typeof globalThis & TokenHolder;
  let token = holder[BOOT_TOKEN_KEY];
  if (token === undefined) {
    token = randomBytes(32).toString("base64url");
    holder[BOOT_TOKEN_KEY] = token;
  }
  return token;
}
