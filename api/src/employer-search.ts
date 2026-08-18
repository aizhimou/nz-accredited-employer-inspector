const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
const MAX_QUERY_TOKENS = 24;

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function tokenizeEmployerSearch(value: string): string[] {
  return unique(
    value
      .normalize("NFKC")
      .toLowerCase()
      .match(TOKEN_PATTERN) ?? [],
  ).slice(0, MAX_QUERY_TOKENS);
}

export function buildEmployerFtsQuery(value: string): string | null {
  const tokens = tokenizeEmployerSearch(value).filter((token) => token.length >= 2);
  if (tokens.length === 0) {
    return null;
  }
  return tokens
    .map((token) => `"${token}"${token.length >= 3 ? "*" : ""}`)
    .join(" AND ");
}
