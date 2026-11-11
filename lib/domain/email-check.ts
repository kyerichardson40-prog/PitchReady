/** Throwaway email check for free pilots (D46). Matches the domain and any parent domain. */
let set: Set<string> | null = null;
export function isDisposableEmail(email: string, list: string): boolean {
  set ??= new Set(list.split('\n'));
  const domain = email.trim().toLowerCase().split('@').pop() ?? '';
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) if (set.has(parts.slice(i).join('.'))) return true;
  return false;
}
