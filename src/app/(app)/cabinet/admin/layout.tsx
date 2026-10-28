import '../../../../styles/admin-panel.css';
import AdminPanelLayout from '@/components/admin/AdminPanelLayout';

export const metadata = {
  title: 'Панель управления — District',
};

export default function AdminPanelRootLayout({ children }: { children: React.ReactNode }) {
  return <AdminPanelLayout>{children}</AdminPanelLayout>;
}
