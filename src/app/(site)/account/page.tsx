import { redirect } from 'next/navigation';

// Старая точка входа в кабинет: теперь кабинет ученика живёт на /cabinet.
export default function AccountPage() {
  redirect('/cabinet');
}
