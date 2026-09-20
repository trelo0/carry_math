'use client';

import { useEffect, useState } from 'react';
import { buildYoutubeLiveChatUrl } from '@/lib/youtube';

type Props = {
  videoId: string;
};

export default function YoutubeLiveChat({ videoId }: Props) {
  const [embedDomain, setEmbedDomain] = useState<string | null>(null);

  useEffect(() => {
    setEmbedDomain(window.location.hostname);
  }, []);

  return (
    <div className="cab-lespage-chat">
      <header className="cab-lespage-chat-head">
        <h2>Чат трансляции</h2>
      </header>
      {embedDomain ? (
        <iframe
          className="cab-lespage-chat-frame"
          src={buildYoutubeLiveChatUrl(videoId, embedDomain)}
          title="Чат трансляции YouTube"
          referrerPolicy="origin"
        />
      ) : (
        <div className="cab-lespage-chat-empty">
          <p>Загрузка чата…</p>
        </div>
      )}
    </div>
  );
}
