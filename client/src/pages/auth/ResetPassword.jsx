import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import BrandLogo from '../../components/common/BrandLogo';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import api from '../../api/axios';

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!token) return setError('This reset link is incomplete.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirmPassword) return setError('Passwords do not match.');

    setLoading(true);
    try {
      const response = await api.post('/auth/reset-password', { token, password });
      setMessage(response.data.message);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to reset password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-layout">
      {loading && <LoadingSpinner message="Saving your new password" />}
      <section className="auth-brand-panel" aria-label="Smartrack introduction">
        <div className="auth-brand">
          <BrandLogo className="auth-brand-lockup" size="lg" />
        </div>
        <h1>Choose a new password and get back to your workspace.</h1>
      </section>

      <section className="auth-form-panel">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <BrandLogo className="auth-brand-lockup" size="lg" />
          </div>

          <header className="auth-card-header">
            <h2>New password</h2>
            <p>Use at least 8 characters for your replacement password.</p>
          </header>

          {message ? (
            <>
              <div className="auth-alert auth-alert-success">{message}</div>
              <Link to="/login" className="btn-primary auth-submit">Sign in</Link>
            </>
          ) : (
            <form onSubmit={submit}>
              <div className="form-group">
                <label htmlFor="reset-password">New password</label>
                <input id="reset-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="new-password" />
              </div>
              <div className="form-group">
                <label htmlFor="reset-confirm">Confirm password</label>
                <input id="reset-confirm" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
              </div>
              {error && <div className="auth-alert auth-alert-danger" role="alert">{error}</div>}
              <button className="btn-primary auth-submit" disabled={loading || !token}>
                {loading ? 'Resetting…' : 'Reset password'}
              </button>
            </form>
          )}

          <div className="auth-register">
            <Link to="/login">Back to sign in</Link>
          </div>
        </div>
      </section>
    </main>
  );
};

export default ResetPassword;
