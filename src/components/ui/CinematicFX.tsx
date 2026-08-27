'use client';

// Кино-слой поверх кадра: мягкая виньетка.
// pointer-events: none и ни на что не влияет.

export default function CinematicFX() {
  return (
    <>
      <div className="cine-vignette" aria-hidden="true" />
    </>
  );
}
