const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
const MIN_FUZZY_SCORE = 0.5;
const MAX_NAME_TOKENS = 24;

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function tokenizeEmployerName(value: string): string[] {
  return unique(
    value
      .normalize("NFKC")
      .toLowerCase()
      .match(TOKEN_PATTERN) ?? [],
  ).slice(0, MAX_NAME_TOKENS);
}

export function buildEmployerFtsQuery(value: string): string | null {
  const tokens = tokenizeEmployerName(value).filter((token) => token.length >= 2);
  if (tokens.length === 0) {
    return null;
  }
  return tokens
    .map((token) => `"${token}"${token.length >= 3 ? "*" : ""}`)
    .join(" OR ");
}

function tokenWeight(token: string): number {
  return Math.min(10, Math.max(2, [...token].length));
}

function isSubsequence(shorter: string, longer: string): boolean {
  let shortIndex = 0;
  for (const character of longer) {
    if (character === shorter[shortIndex]) {
      shortIndex += 1;
      if (shortIndex === shorter.length) {
        return true;
      }
    }
  }
  return false;
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function tokenSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length >= 3 && longer.startsWith(shorter)) {
    return 0.88;
  }
  if (shorter.length >= 2 && isSubsequence(shorter, longer)) {
    return 0.58 + 0.24 * (shorter.length / longer.length);
  }
  if (shorter.length < 2) {
    return 0;
  }
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  if (leftBigrams.size === 0 || rightBigrams.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const bigram of leftBigrams) {
    if (rightBigrams.has(bigram)) {
      overlap += 1;
    }
  }
  return Math.min(0.72, (2 * overlap) / (leftBigrams.size + rightBigrams.size));
}

function applyPairScores(
  left: readonly string[],
  right: readonly string[],
  leftScores: number[],
  rightScores: number[],
): void {
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const score = tokenSimilarity(left[leftIndex] ?? "", right[rightIndex] ?? "");
      leftScores[leftIndex] = Math.max(leftScores[leftIndex] ?? 0, score);
      rightScores[rightIndex] = Math.max(rightScores[rightIndex] ?? 0, score);
    }
  }
}

function applyAcronymScores(
  abbreviations: readonly string[],
  expanded: readonly string[],
  abbreviationScores: number[],
  expandedScores: number[],
): void {
  for (let abbreviationIndex = 0; abbreviationIndex < abbreviations.length; abbreviationIndex += 1) {
    const abbreviation = abbreviations[abbreviationIndex] ?? "";
    if (abbreviation.length < 2 || abbreviation.length > 6) {
      continue;
    }
    for (let start = 0; start < expanded.length - 1; start += 1) {
      for (let size = 2; size <= 6 && start + size <= expanded.length; size += 1) {
        const group = expanded.slice(start, start + size);
        const acronym = group.map((token) => token[0] ?? "").join("");
        if (acronym !== abbreviation) {
          continue;
        }
        abbreviationScores[abbreviationIndex] = Math.max(
          abbreviationScores[abbreviationIndex] ?? 0,
          0.94,
        );
        for (let index = start; index < start + size; index += 1) {
          expandedScores[index] = Math.max(expandedScores[index] ?? 0, 0.94);
        }
      }
    }
  }
}

function weightedCoverage(tokens: readonly string[], scores: readonly number[]): number {
  let matched = 0;
  let total = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const weight = tokenWeight(tokens[index] ?? "");
    total += weight;
    matched += weight * (scores[index] ?? 0);
  }
  return total === 0 ? 0 : matched / total;
}

export function scoreEmployerName(query: string, candidate: string): number {
  const queryTokens = tokenizeEmployerName(query);
  const candidateTokens = tokenizeEmployerName(candidate);
  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }
  if (queryTokens.join(" ") === candidateTokens.join(" ")) {
    return 1;
  }

  const queryScores = queryTokens.map(() => 0);
  const candidateScores = candidateTokens.map(() => 0);
  applyPairScores(queryTokens, candidateTokens, queryScores, candidateScores);
  applyAcronymScores(queryTokens, candidateTokens, queryScores, candidateScores);
  applyAcronymScores(candidateTokens, queryTokens, candidateScores, queryScores);

  const queryCoverage = weightedCoverage(queryTokens, queryScores);
  const candidateCoverage = weightedCoverage(candidateTokens, candidateScores);
  return 0.65 * queryCoverage + 0.35 * candidateCoverage;
}

export function scoreEmployerCandidate(
  query: string,
  employerName: string,
  tradingName: string | null,
): number {
  return Math.max(
    scoreEmployerName(query, employerName),
    tradingName === null ? 0 : scoreEmployerName(query, tradingName),
  );
}

export function isPlausibleEmployerNameScore(score: number): boolean {
  return score >= MIN_FUZZY_SCORE;
}
