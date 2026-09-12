const Bone = ({ className = '', style }) => (
  <span className={`skeleton-bone ${className}`.trim()} style={style} aria-hidden="true" />
);

const DashboardSkeleton = () => (
  <div className="skeleton-page">
    <div className="skeleton-header">
      <div className="skeleton-copy">
        <Bone className="skeleton-line skeleton-line-sm" />
        <Bone className="skeleton-line skeleton-line-lg" />
        <Bone className="skeleton-line skeleton-line-md" />
      </div>
      <div className="skeleton-actions">
        <Bone className="skeleton-chip" />
        <Bone className="skeleton-chip" />
      </div>
    </div>
    <div className="skeleton-stats">
      {Array.from({ length: 3 }, (_, index) => (
        <div className="skeleton-card" key={index}>
          <Bone className="skeleton-line skeleton-line-xs" />
          <Bone className="skeleton-line skeleton-line-xl" />
          <Bone className="skeleton-line skeleton-line-sm" />
        </div>
      ))}
    </div>
    {Array.from({ length: 4 }, (_, index) => (
      <div className="skeleton-card skeleton-row" key={`row-${index}`}>
        <Bone className="skeleton-avatar" />
        <div className="skeleton-copy">
          <Bone className="skeleton-line skeleton-line-md" />
          <Bone className="skeleton-line skeleton-line-sm" />
        </div>
        <Bone className="skeleton-chip" />
      </div>
    ))}
  </div>
);

const ListSkeleton = () => (
  <div className="skeleton-page">
    {Array.from({ length: 5 }, (_, index) => (
      <div className="skeleton-card skeleton-row" key={index}>
        <Bone className="skeleton-avatar" />
        <div className="skeleton-copy">
          <Bone className="skeleton-line skeleton-line-md" />
          <Bone className="skeleton-line skeleton-line-sm" />
        </div>
        <Bone className="skeleton-chip" />
      </div>
    ))}
  </div>
);

const TableSkeleton = () => (
  <div className="skeleton-page">
    <div className="skeleton-card skeleton-table">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="skeleton-table-row" key={index}>
          <Bone className="skeleton-line" />
          <Bone className="skeleton-line" />
          <Bone className="skeleton-line" />
          <Bone className="skeleton-line skeleton-line-sm" />
        </div>
      ))}
    </div>
  </div>
);

const ProfileSkeleton = () => (
  <div className="skeleton-page">
    <div className="skeleton-card skeleton-row">
      <Bone className="skeleton-avatar skeleton-avatar-lg" />
      <div className="skeleton-copy">
        <Bone className="skeleton-line skeleton-line-lg" />
        <Bone className="skeleton-line skeleton-line-md" />
      </div>
    </div>
    <div className="skeleton-card">
      {Array.from({ length: 4 }, (_, index) => (
        <div className="skeleton-field" key={index}>
          <Bone className="skeleton-line skeleton-line-xs" />
          <Bone className="skeleton-line skeleton-line-lg" />
        </div>
      ))}
    </div>
  </div>
);

const MapSkeleton = () => (
  <div className="skeleton-page">
    <div className="skeleton-header">
      <Bone className="skeleton-line skeleton-line-lg" />
      <Bone className="skeleton-chip" />
    </div>
    <div className="skeleton-card skeleton-map" />
  </div>
);

const variants = {
  dashboard: DashboardSkeleton,
  list: ListSkeleton,
  table: TableSkeleton,
  profile: ProfileSkeleton,
  map: MapSkeleton,
};

const SkeletonPage = ({ variant = 'dashboard', label = 'Loading workspace' }) => {
  const View = variants[variant] || DashboardSkeleton;
  return (
    <div className="skeleton-shell" role="status" aria-live="polite" aria-busy="true" aria-label={label}>
      <View />
    </div>
  );
};

export { Bone };
export default SkeletonPage;
