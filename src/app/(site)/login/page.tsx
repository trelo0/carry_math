import { redirect } from 'next/navigation';
import { siteLoginRedirectPath } from '@/lib/auth-login-redirect';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  redirect(siteLoginRedirectPath(sp.next));
}
