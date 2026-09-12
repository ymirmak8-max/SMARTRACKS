import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/axios';
import VectorIcon from '../../components/common/VectorIcon';
import BrandLogo from '../../components/common/BrandLogo';
import LoadingSpinner from '../../components/common/LoadingSpinner';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to send reset email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-layout">
      {loading && <LoadingSpinner message="Sending reset instructions" />}
      <section className="auth-brand-panel" aria-label="Smartrack introduction">
        <div className="auth-brand">
          <BrandLogo className="auth-brand-lockup" size="lg" />
        </div>
        <h1>Reset access and return to your live OJT workspace.</h1>
      </section>

      <section className="auth-form-panel">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <BrandLogo className="auth-brand-lockup" size="lg" />
          </div>

          <header className="auth-card-header">
            <h2>Reset password</h2>
            <p>Enter the email on your account to receive reset instructions.</p>
          </header>

          {sent ? (
            <>
              <div className="auth-alert auth-alert-success">
                <strong>Check your email.</strong> Reset instructions were sent to {email}.
              </div>
              <Link to="/login" className="btn-primary auth-submit">Back to sign in</Link>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="forgot-email">Email address</label>
                <input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="School email you used to register"
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>

              {error && (
                <div className="auth-alert auth-alert-danger" role="alert">
                  <span className="icon-label"><VectorIcon name="alert" size={16} /> {error}</span>
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary auth-submit">
                {loading ? 'Sending…' : 'Send reset instructions'}
              </button>
            </form>
          )}

          <div className="auth-register">
            Remember your password? <Link to="/login">Sign in</Link>
          </div>
        </div>
      </section>
    </main>
  );
};

export default ForgotPassword;
