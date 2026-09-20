import { notFound } from 'next/navigation';
import CabinetShell from '@/components/cabinet/CabinetShell';
import {
  buildCabinetPreviewData,
  enrichCabinetPreviewWithSanity,
} from '@/lib/cabinet-preview-data';
import type { CourseCabinetState } from '@/lib/cabinet';

const DEMO_CREATED_AT = new Date(Date.now() - 17 * 86_400_000).toISOString();

const VARIANTS = ['preview', 'enrolled_locked', 'full', 'lessons_only'] as const;
type PreviewVariant = (typeof VARIANTS)[number] | CourseCabinetState;

function parseVariant(value: string | undefined): PreviewVariant {
  if (value && (VARIANTS as readonly string[]).includes(value)) {
    return value as PreviewVariant;
  }
  return 'full';
}

// Dev-страница превью кабинета. На проде недоступна.
// ?state=preview|enrolled_locked|full|lessons_only
export default async function CabinetPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; section?: string }>;
}) {
  if (process.env.NODE_ENV !== 'development') {
    notFound();
  }

  const sp = await searchParams;
  const variant = parseVariant(sp.state);
  const data = await enrichCabinetPreviewWithSanity(buildCabinetPreviewData(DEMO_CREATED_AT, variant));

  return (
    <CabinetShell
      data={data}
      initialSection={
        sp.section === 'lessons' || sp.section === 'course' || sp.section === 'payments'
          ? sp.section
          : variant === 'lessons_only'
            ? 'lessons'
            : 'course'
      }
    />
  );
}
