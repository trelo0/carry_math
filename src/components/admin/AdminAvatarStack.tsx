import type { AdminCoursePerson } from '@/lib/admin/courses-data';

const MAX_VISIBLE = 2;

function initials(name: string): string {
  const parts = name
    .replace(/^ID\s+/i, '')
    .split(/\s+/)
    .map((w) => Array.from(w).filter((ch) => /[\p{L}\p{N}]/u.test(ch)))
    .filter((w) => w.length > 0);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).join('').toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function hueFor(id: number): number {
  return (Math.abs(id) * 47) % 360;
}

export default function AdminAvatarStack({ people }: { people: AdminCoursePerson[] }) {
  if (people.length === 0) return <span className="admin-panel__cell-muted">—</span>;
  const visible = people.slice(0, MAX_VISIBLE);
  const rest = people.length - visible.length;
  return (
    <div className="admin-avatars" title={people.map((p) => p.name).join(', ')}>
      {visible.map((p) => (
        <span
          key={p.telegramId}
          className="admin-avatars__item"
          style={{ background: `hsl(${hueFor(p.telegramId)} 45% 38%)` }}
        >
          {initials(p.name)}
        </span>
      ))}
      {rest > 0 ? <span className="admin-avatars__more">+{rest}</span> : null}
    </div>
  );
}
