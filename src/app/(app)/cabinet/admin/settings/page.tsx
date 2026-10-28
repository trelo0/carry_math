import Link from 'next/link';
import { redirect } from 'next/navigation';
import AdminActivityNotifications from '@/components/admin/AdminActivityNotifications';
import AdminCabinetPreview from '@/components/admin/AdminCabinetPreview';
import AdminSanityEditor, { type EditorBlock, type EditorDoc } from '@/components/admin/AdminSanityEditor';
import { getAdminCabinetContext } from '@/lib/admin/auth';
import { getFormDoc, loadSettingsTabDocs, settingsWriteEnabled } from '@/lib/admin/settings-docs';
import { SETTINGS_TABS, parseSettingsTab, settingsTabDocRefs } from '@/lib/admin/settings-sections';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; login?: string }>;
}) {
  const ctx = await getAdminCabinetContext();
  if (!ctx) redirect('/cabinet');

  const sp = await searchParams;
  const tabId = parseSettingsTab(sp.tab);
  const tab = SETTINGS_TABS.find((t) => t.id === tabId)!;
  const writeEnabled = settingsWriteEnabled();

  let items: EditorDoc[] = [];
  let blocks: EditorBlock[] | undefined;
  let loadError: string | null = null;

  if (tab.id !== 'cabinets' && tab.id !== 'notifications') {
    try {
      const byType = await loadSettingsTabDocs(tab.id);
      const docRefs = settingsTabDocRefs(tab);
      items = docRefs.map((ref) => ({
        ref,
        form: getFormDoc(ref.type)!,
        docs: byType[ref.type] ?? [],
      }));
      if (tab.blocks?.length) {
        blocks = tab.blocks.map((block) => ({
          title: block.title,
          items: block.docs.map((ref) => {
            const hit = items.find((i) => i.ref.type === ref.type && i.ref.kind === ref.kind);
            if (!hit) throw new Error(`Missing doc ${ref.type}`);
            return hit;
          }),
        }));
      }
    } catch (error) {
      console.error('[admin settings]', error);
      loadError = error instanceof Error ? error.message : 'Не удалось загрузить контент из Sanity';
    }
  }

  return (
    <div className="admin-sf-page">
      <div className="admin-sf__tabbar">
        <nav className="admin-sf__tabs" aria-label="Разделы настроек">
          {SETTINGS_TABS.map((t) => (
            <Link
              key={t.id}
              href={t.id === 'general' ? '/cabinet/admin/settings' : `/cabinet/admin/settings?tab=${t.id}`}
              className={`admin-sf__tab${t.id === tab.id ? ' is-active' : ''}`}
              aria-current={t.id === tab.id ? 'page' : undefined}
              prefetch={false}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <a href="/studio" target="_blank" rel="noopener noreferrer" className="admin-sf__btn admin-sf__studio">
          Открыть Sanity Studio
        </a>
      </div>

      {tab.id === 'notifications' ? (
        <AdminActivityNotifications />
      ) : tab.id === 'cabinets' ? (
        <AdminCabinetPreview />
      ) : (
        <>
          {!writeEnabled ? (
            <div className="admin-fin__notice admin-fin__notice--warn">
              <code>SANITY_API_WRITE_TOKEN</code> не настроен — редактирование с сайта недоступно. Контент можно править
              в Sanity Studio.
            </div>
          ) : null}
          {loadError ? (
            <div className="admin-fin__notice admin-fin__notice--warn">{loadError}</div>
          ) : (
            <AdminSanityEditor key={tab.id} items={items} blocks={blocks} writeEnabled={writeEnabled} />
          )}
        </>
      )}
    </div>
  );
}
