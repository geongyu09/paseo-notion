/** The token for `space`: null means the first token, and a hash whose token was removed means none. */
export const pickToken = (tokens: string[], space: string | null, hash: (token: string) => string) =>
  space === null ? tokens[0] : tokens.find((token) => hash(token) === space);
