import NotificationBell from './NotificationBell';
import UserMenu from './UserMenu';

const DashboardTopbar = ({ role, onEditProfile }) => {
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : '';

  return (
    <div className="floating-chrome" aria-label={`${roleLabel || 'User'} shortcuts`}>
      <NotificationBell />
      <div className="floating-chrome-profile">
        <UserMenu onEditProfile={onEditProfile} />
      </div>
    </div>
  );
};

export default DashboardTopbar;
