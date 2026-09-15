import { useState } from 'react';
import api from '../../api/axios';
import useAuth from '../../hooks/useAuth';

const SecuritySettings = () => {
  const { user, refreshUser } = useAuth();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const begin = async () => {
    setBusy(true); setMessage('');
    try { setSetup((await api.post('/auth/mfa/setup')).data); }
    catch (error) { setMessage(error.response?.data?.message || 'MFA setup failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ marginBottom: '.875rem' }}>
      <div className="card-title">Account security</div>
      <p style={{ color: 'var(--text-2)', marginBottom: '.75rem' }}>
        Authenticator MFA is {user?.mfaEnabled ? 'enabled' : 'not enabled'}.
      </p>
      {!user?.mfaEnabled && !setup && (
        <button className="btn-compact-primary" disabled={busy} onClick={begin}>Set up authenticator MFA</button>
      )}
      {setup && (
        <div>
          <p>In your authenticator app, add an account manually using this secret:</p>
          <code style={{ display: 'block', padding: '.75rem', margin: '.75rem 0', overflowWrap: 'anywhere' }}>{setup.secret}</code>
          <div className="form-group"><label>Six-digit code</label>
            <input inputMode="numeric" maxLength={6} value={code}
              onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
          </div>
          <button className="btn-compact-primary" disabled={busy || code.length !== 6} onClick={async () => {
            setBusy(true);
            try {
              await api.post('/auth/mfa/confirm', { code });
              setMessage('MFA enabled. It will be required on your next login.');
              setSetup(null);
              await refreshUser();
            } catch (error) { setMessage(error.response?.data?.message || 'Code verification failed.'); }
            finally { setBusy(false); }
          }}>Confirm and enable</button>
        </div>
      )}
      {user?.mfaEnabled && (
        <div>
          <div className="form-group"><label>Current password to disable MFA</label>
            <input type="password" value={password} onChange={event => setPassword(event.target.value)} />
          </div>
          <button className="action-btn action-btn-danger" disabled={busy || !password} onClick={async () => {
            setBusy(true);
            try { await api.delete('/auth/mfa', { data: { password } }); setMessage('MFA disabled. Sign in again to refresh your account state.'); }
            catch (error) { setMessage(error.response?.data?.message || 'MFA could not be disabled.'); }
            finally { setBusy(false); }
          }}>Disable MFA</button>
        </div>
      )}
      {message && <p style={{ marginTop: '.75rem' }} role="status">{message}</p>}
    </div>
  );
};

export default SecuritySettings;
