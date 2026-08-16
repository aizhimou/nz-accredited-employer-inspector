export interface FreshnessPolicy {
  positiveTtlSeconds: number;
  negativeTtlSeconds: number;
  refreshAttemptCooldownSeconds: number;
  refreshNoMatchCooldownSeconds: number;
}

interface FreshnessEnv {
  POSITIVE_TTL_SECONDS: unknown;
  NEGATIVE_TTL_SECONDS: unknown;
  REFRESH_ATTEMPT_COOLDOWN_SECONDS: unknown;
  REFRESH_NO_MATCH_COOLDOWN_SECONDS: unknown;
}

function parseTtlSeconds(name: string, value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer number of seconds.`);
  }
  return parsed;
}

export function readFreshnessPolicy(env: FreshnessEnv): FreshnessPolicy {
  return {
    positiveTtlSeconds: parseTtlSeconds(
      "POSITIVE_TTL_SECONDS",
      env.POSITIVE_TTL_SECONDS,
    ),
    negativeTtlSeconds: parseTtlSeconds(
      "NEGATIVE_TTL_SECONDS",
      env.NEGATIVE_TTL_SECONDS,
    ),
    refreshAttemptCooldownSeconds: parseTtlSeconds(
      "REFRESH_ATTEMPT_COOLDOWN_SECONDS",
      env.REFRESH_ATTEMPT_COOLDOWN_SECONDS,
    ),
    refreshNoMatchCooldownSeconds: parseTtlSeconds(
      "REFRESH_NO_MATCH_COOLDOWN_SECONDS",
      env.REFRESH_NO_MATCH_COOLDOWN_SECONDS,
    ),
  };
}
