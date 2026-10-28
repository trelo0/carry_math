import { redirect } from 'next/navigation';

export default function AdminIndexPage() {
  redirect('/cabinet/admin/courses');
}
