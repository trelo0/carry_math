import { AuthModal } from '@/components';
import '../../styles/cabinet.css';
import '../../styles/schedule-calendar.css';

/** Кабинет без маркетинговой шапки; вход — через CabinetLoginGate (?login=1). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AuthModal />
    </>
  );
}
