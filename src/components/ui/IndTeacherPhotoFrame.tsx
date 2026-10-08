"use client";

import { useId } from "react";

/** HUD-рамка фото: ступенька сверху под цифру + notch на стыке, как в рефе. */
export default function IndTeacherPhotoFrame() {
  const uid = useId().replace(/:/g, "");
  const glow = `${uid}-photo-glow`;

  return (
    <svg
      className="teacher-hud-photo-frame-svg"
      viewBox="0 0 260 320"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <filter id={glow} x="-8%" y="-6%" width="116%" height="112%">
          <feDropShadow dx="0" dy="0" stdDeviation="0.45" floodColor="rgba(90, 190, 255, 0.65)" />
        </filter>
      </defs>

      <g
        fill="none"
        stroke="rgba(120, 205, 255, 0.78)"
        strokeWidth="1.15"
        strokeLinecap="square"
        strokeLinejoin="miter"
        filter={`url(#${glow})`}
      >
        {/* верх: линия → ступенька вправо (место под 01) */}
        <path d="M 8 28 H 168 V 8 H 248 L 260 20" />
        {/* правый край до низа карточки */}
        <path d="M 260 20 V 320" />
        {/* низ — вровень с нижней линией карточки */}
        <path d="M 260 320 H 8" />
        {/* левый край со стыковочными notch */}
        <path d="M 8 320 V 236" />
        <path d="M 8 236 H 18 V 220 H 8" />
        <path d="M 8 220 V 100" />
        <path d="M 8 100 H 18 V 84 H 8" />
        <path d="M 8 84 V 28" />

        {/* уголки */}
        <path d="M 14 34 H 34 M 14 34 V 52" stroke="rgba(140, 215, 255, 0.9)" strokeWidth="1.25" />
        <path d="M 252 312 H 232 M 252 312 V 292" stroke="rgba(140, 215, 255, 0.85)" strokeWidth="1.25" />
      </g>
    </svg>
  );
}
