/** ID видео/трансляции из ссылки YouTube. */
export function extractYoutubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  return match?.[1] ?? null;
}

export function buildYoutubeEmbedUrl(
  videoId: string,
  autoplay = false,
  options?: { disableNativeFullscreen?: boolean },
): string {
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    iv_load_policy: '3',
    disablekb: '1',
  });
  if (autoplay) params.set('autoplay', '1');
  if (options?.disableNativeFullscreen) params.set('fs', '0');
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

export function buildYoutubeLiveChatUrl(videoId: string, embedDomain: string): string {
  const params = new URLSearchParams({
    v: videoId,
    embed_domain: embedDomain,
    dark_theme: '1',
  });
  return `https://www.youtube.com/live_chat?${params.toString()}`;
}
