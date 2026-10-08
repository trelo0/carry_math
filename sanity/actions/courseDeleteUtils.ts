/** Общие хелперы для cascade-delete курса / модуля / занятия. */

export function bareId(id: string): string {
  return id.replace(/^drafts\./, '')
}

export function idPair(id: string): string[] {
  const bare = bareId(id)
  return [bare, `drafts.${bare}`]
}

export type SanityRef = {_key?: string; _ref?: string; _type?: string; _weak?: boolean}

export function filterOutRefs(list: SanityRef[] | undefined, drop: string[]): SanityRef[] {
  const dropSet = new Set(drop)
  return (list ?? []).filter((ref) => !ref?._ref || !dropSet.has(ref._ref))
}
