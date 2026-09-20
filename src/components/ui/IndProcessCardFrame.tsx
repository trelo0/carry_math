"use client";

import { useId } from "react";

export default function IndProcessCardFrame() {
  const uid = useId().replace(/:/g, "");
  const blueGlow = `${uid}-blue-glow`;
  const orangeGlow = `${uid}-orange-glow`;

  return (
    <svg
      className="ind-process-frame"
      viewBox="0 0 472 114"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <filter id={blueGlow} x="-8%" y="-12%" width="116%" height="124%">
          <feDropShadow dx="0" dy="0" stdDeviation="0.65" floodColor="rgba(72, 170, 255, 0.75)" />
        </filter>
        <filter id={orangeGlow} x="-8%" y="-12%" width="116%" height="124%">
          <feDropShadow dx="0" dy="0" stdDeviation="0.7" floodColor="rgba(255, 154, 46, 0.72)" />
        </filter>
      </defs>

      <g fill="none" strokeLinecap="square" strokeLinejoin="miter">
        {/* Main card outline */}
        <path
          d="M 16 0 H 448 L 452 2.5 L 455 0 H 472 V 98 L 456 114 H 0 V 16 L 16 0 Z"
          stroke="rgba(72, 170, 255, 0.92)"
          strokeWidth="1"
          filter={`url(#${blueGlow})`}
        />

        {/* Top edge accent after chamfer */}
        <path
          d="M 16 0 H 52"
          stroke="rgba(72, 170, 255, 0.62)"
          strokeWidth="0.75"
          filter={`url(#${blueGlow})`}
        />

        {/* Bottom-right edge accent */}
        <path
          d="M 408 114 H 456"
          stroke="rgba(72, 170, 255, 0.62)"
          strokeWidth="0.75"
          filter={`url(#${blueGlow})`}
        />

        {/* Double HUD brackets — top-left */}
        <path d="M 16 0 L 0 16" stroke="rgba(72, 170, 255, 0.9)" strokeWidth="1" filter={`url(#${blueGlow})`} />
        <path d="M 11 0 L 0 11" stroke="rgba(255, 154, 46, 0.86)" strokeWidth="0.75" filter={`url(#${orangeGlow})`} />

        {/* Double HUD brackets — bottom-right */}
        <path d="M 472 98 L 456 114" stroke="rgba(72, 170, 255, 0.9)" strokeWidth="1" filter={`url(#${blueGlow})`} />
        <path d="M 472 93 L 461 114" stroke="rgba(255, 154, 46, 0.82)" strokeWidth="0.75" filter={`url(#${orangeGlow})`} />

        {/* Orange left edge + num-zone bottom */}
        <path
          d="M 0 16 L 0 114 M 0 114 L 128 114"
          stroke="rgba(255, 154, 46, 0.92)"
          strokeWidth="1.15"
          filter={`url(#${orangeGlow})`}
        />
      </g>
    </svg>
  );
}
