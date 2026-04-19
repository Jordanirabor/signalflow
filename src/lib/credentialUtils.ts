/**
 * Pure utility functions for credential handling.
 *
 * All functions are pure (no side effects, no I/O).
 */

/**
 * Masks a password for safe display, showing only the last 4 characters
 * with all preceding characters replaced by `*`.
 *
 * For passwords of length >= 4, returns `*` repeated (length - 4) times
 * followed by the last 4 characters.
 * For passwords shorter than 4 characters, returns all `*` of the same length.
 * For empty strings, returns an empty string.
 */
export function maskPassword(password: string): string {
  if (password.length >= 4) {
    return '*'.repeat(password.length - 4) + password.slice(-4);
  }
  return '*'.repeat(password.length);
}
