import { isCreatorTelegramId, loadMemberRoles, memberHasRole } from '@/lib/bot/roles';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCabinetData } from '@/lib/cabinet';
import CabinetShell from '@/components/cabinet/CabinetShell';
import CabinetTelegramGate from '@/components/cabinet/CabinetTelegramGate';
import CtaIntentConsumer from '@/components/cabinet/CtaIntentConsumer';

const SECTIONS = ['course', 'payments', 'settings'] as const;
type CabinetSection = (typeof SECTIONS)[number];

const LEGACY_SECTION_MAP: Record<string, CabinetSection> = {
  lessons: 'course',
  schedule: 'course',
};

function parseSection(value: string | undefined): CabinetSection | undefined {
  if (!value) return undefined;
  if (SECTIONS.includes(value as CabinetSection)) return value as CabinetSection;
  return LEGACY_SECTION_MAP[value];
}

function parsePaymentResult(value: string | undefined): 'success' | 'failed' | undefined {
  if (value === 'success' || value === 'failed') return value;
  return undefined;
}

export default async function CabinetPageContent({
  phone,
  createdAt,
  courseSlug,
  section,
  payment,
  returnTo,
  cabinetPreview,
}: {
  phone: string;
  createdAt: string;
  courseSlug?: string;
  section?: string;
  payment?: string;
  returnTo: string;
  cabinetPreview?: 'student';
}) {
  const cabinet = await getCabinetData(phone, createdAt, courseSlug, {
    loadMapProgress: false,
    deferSecondaryData: true,
    deferHeavyMaintenance: true,
  });

  if (!cabinet.telegramLinked) {
    return <CabinetTelegramGate returnTo={returnTo} />;
  }

  let showCabinetPick = cabinetPreview === 'student';
  if (showCabinetPick && cabinet.telegramId != null) {
    try {
      const roles = await loadMemberRoles(createAdminClient(), cabinet.telegramId);
      showCabinetPick = isCreatorTelegramId(cabinet.telegramId) || memberHasRole(roles, 'admin');
    } catch {
      showCabinetPick = false;
    }
  }

  return (
    <>
      <CtaIntentConsumer />
      <CabinetShell
        data={cabinet}
        initialSection={parseSection(section)}
        initialPaymentResult={parsePaymentResult(payment)}
        showCabinetPick={showCabinetPick}
      />
    </>
  );
}
