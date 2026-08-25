'use client';

// Кино-слой поверх кадра: виньетка и плёночное зерно.
// Оба слоя — pointer-events: none и ни на что не влияют.

export default function CinematicFX() {
  return (
    <>
      <div className="cine-vignette" aria-hidden="true" />
      <div className="cine-grain" aria-hidden="true" />
    </>
  );
}
