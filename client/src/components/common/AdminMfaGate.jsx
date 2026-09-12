import SecuritySettings from './SecuritySettings';
import useAuth from '../../hooks/useAuth';

const AdminMfaGate = ({ children }) => {
  const { user, logout } = useAuth();
  if (!user || user.role !== 'admin' || user.mfaEnabled) return children;
  return (
    <main className="privacy-page">
      <section className="privacy-card" aria-labelledby="mfa-required-title">
        <header className="privacy-header">
          <span className="privacy-eyebrow">Required administrator protection</span>
          <h1 id="mfa-required-title">Secure your administrator account</h1>
          <p>Administrators must use an authenticator app. Until setup is complete, all other administrator functions remain locked.</p>
        </header>
        <SecuritySettings />
        <button type="button" className="btn-secondary" onClick={logout}>Sign out</button>
      </section>
    </main>
  );
};

export default AdminMfaGate;
