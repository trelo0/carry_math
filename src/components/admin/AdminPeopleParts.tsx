import type { PersonRoleBadge } from '@/lib/admin/people-data';

export function personInitials(name: string): string {
  const parts = name
    .replace(/^ID\s+/i, '')
    .split(/\s+/)
    .map((w) => Array.from(w).filter((ch) => /[\p{L}\p{N}]/u.test(ch)))
    .filter((w) => w.length > 0);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).join('').toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function PersonAvatar({
  telegramId,
  name,
  size = 'md',
}: {
  telegramId: number;
  name: string;
  size?: 'md' | 'lg';
}) {
  const hue = (Math.abs(telegramId) * 47) % 360;
  return (
    <span
      className={`admin-person__avatar${size === 'lg' ? ' admin-person__avatar--lg' : ''}`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 46%), hsl(${(hue + 40) % 360} 50% 32%))` }}
      aria-hidden
    >
      {personInitials(name)}
    </span>
  );
}

export function RoleBadge({ badge }: { badge: PersonRoleBadge }) {
  return <span className={`admin-role admin-role--${badge.role}`}>{badge.label}</span>;
}
