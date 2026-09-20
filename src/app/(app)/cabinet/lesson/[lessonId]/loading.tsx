export default function CabinetLessonLoading() {
  return (
    <div className="cab-lespage">
      <div className="cab-lespage-inner">
        <header className="cab-lespage-head">
          <span className="cab-lespage-back cab-lespage-back--placeholder">← Личный кабинет</span>
          <span className="cab-lespage-skeleton cab-lespage-skeleton--k" />
          <div className="cab-lespage-skeleton cab-lespage-skeleton--title" />
        </header>
        <div className="cab-lespage-content">
          <div className="cab-lespage-skeleton cab-lespage-skeleton--video" />
          <div className="cab-lespage-skeleton cab-lespage-skeleton--panel cab-lespage-skeleton--about" />
          <div className="cab-lespage-skeleton cab-lespage-skeleton--panel cab-lespage-skeleton--materials" />
          <div className="cab-lespage-skeleton cab-lespage-skeleton--panel cab-lespage-skeleton--homework" />
        </div>
      </div>
    </div>
  );
}
