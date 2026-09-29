import { redirect } from 'next/navigation';
import { siteRegisterRedirectPath } from '@/lib/auth-login-redirect';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  redirect(siteRegisterRedirectPath(sp.next));
}
