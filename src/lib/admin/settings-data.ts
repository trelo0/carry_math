import { listBotCopyForAdmin } from '@/lib/bot/bot-copy';
import { isSanityWriteConfigured } from '@/lib/studio/courseContentWrite';

export type AdminSettingsLink = {
  id: string;
  title: string;
  description: string;
  href: string;
  external?: boolean;
};

function sanityProjectId(): string {
  return process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '2hngrocd';
}

function sanityStructureUrl(documentType: string, singletonId: string): string {
  return `https://${sanityProjectId()}.sanity.studio/structure/${documentType};${singletonId}`;
}

export function loadAdminSettingsLinks(): AdminSettingsLink[] {
  const studioBase = `/studio`;
  return [
    {
      id: 'studio',
      title: 'Sanity Studio',
      description: 'Полный редактор контента на сайте',
      href: studioBase,
    },
    {
      id: 'site',
      title: 'Настройки сайта',
      description: 'Контакты, SEO, общие параметры лендинга',
      href: sanityStructureUrl('siteSettings', 'siteSettings'),
      external: true,
    },
    {
      id: 'cabinet',
      title: 'Кабинет ученика',
      description: 'Тексты и блоки личного кабинета',
      href: sanityStructureUrl('cabinetSettings', 'cabinetSettings'),
      external: true,
    },
    {
      id: 'bot',
      title: 'Тексты Telegram-бота',
      description: 'Приветствия и сообщения для гостей',
      href: sanityStructureUrl('botSettings', 'botSettings'),
      external: true,
    },
  ];
}

export async function loadAdminBotCopyPreview(): Promise<
  Array<{ key: string; title: string; preview: string }>
> {
  return listBotCopyForAdmin();
}

export function adminSanityWriteEnabled(): boolean {
  return isSanityWriteConfigured();
}
