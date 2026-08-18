import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AccountPanel from '@/components/forms/AccountPanel';

export const metadata = {
  title: 'Кабинет — District',
};

export default async function AccountPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect('/login');
  }

  return (
    <div className="auth-page">
      <div className="container">
        <AccountPanel
          phone={
            (data.user.user_metadata?.phone as string) ?? data.user.phone ?? ''
          }
          createdAt={data.user.created_at}
        />
      </div>
    </div>
  );
}
