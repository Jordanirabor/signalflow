const SEPARATOR = ' / ';

/**
 * Formats an ICP profile into a human-readable label.
 * Concatenates non-empty targetRole, industry, and geography with " / ".
 */
export function formatICPProfileLabel(profile: {
  targetRole: string;
  industry: string;
  geography?: string | null;
}): string {
  const parts = [profile.targetRole, profile.industry, profile.geography ?? ''].filter(
    (p) => p.length > 0,
  );

  return parts.join(SEPARATOR);
}

/**
 * Parses an ICP profile label back into its component fields.
 * Splits on " / " and maps positional segments to targetRole, industry, geography.
 */
export function parseICPProfileLabel(label: string): {
  targetRole: string;
  industry: string | null;
  geography: string | null;
} {
  const parts = label.split(SEPARATOR);

  return {
    targetRole: parts[0] ?? '',
    industry: parts.length > 1 ? parts[1] : null,
    geography: parts.length > 2 ? parts[2] : null,
  };
}
