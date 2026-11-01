/** Accept only same-site relative paths for the post-login redirect. */
export function safeNextPath(next: string | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  return next;
}
