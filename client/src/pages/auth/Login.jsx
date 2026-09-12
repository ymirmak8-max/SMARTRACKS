import { useState } from 'react';
import { useLocation, useNavigate, Link, Navigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import useAuth from '../../hooks/useAuth';
import { ROLE_ROUTES } from '../../App';
import BrandLogo from '../../components/common/BrandLogo';
import LoadingSpinner from '../../components/common/LoadingSpinner';

const Login = () => {
  const { login, verifyMfa, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState('');
  const [mfaCode, setMfaCode] = useState('');

  const handleChange = event => setForm({ ...form, [event.target.name]: event.target.value });

  const handleSubmit = async event => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = mfaChallenge
        ? await verifyMfa(mfaChallenge, mfaCode)
        : await login(form.email, form.password);
      if (result.mfaRequired) {
        setMfaChallenge(result.challengeToken);
        setLoading(false);
        return;
      }
      navigate(ROLE_ROUTES[result.role] || '/login', { replace: true });
    } catch (requestError) {
      setError(requestError.response?.data?.message || (requestError.request
        ? 'Cannot reach the Smartrack server. Reopen the current system link and check your internet connection.'
        : 'Login failed. Please try again.'));
      setLoading(false);
    }
  };

  if (!authLoading && user)
    return <Navigate to={ROLE_ROUTES[user.role] || '/'} replace />;

  return (
    <main className="auth-layout">
      {loading && <LoadingSpinner message={mfaChallenge ? 'Verifying your code' : 'Signing you in'} />}
      <section className="auth-brand-panel" aria-label="Smartrack introduction">
        <div className="auth-brand">
          <BrandLogo className="auth-brand-lockup" size="lg" />
        </div>
        <h1>Live attendance, progress, and OJT performance in one workspace.</h1>
      </section>

      <section className="auth-form-panel">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <BrandLogo className="auth-brand-lockup" size="lg" />
          </div>

          <header className="auth-card-header">
            <h2>Welcome back</h2>
            <p>Sign in to continue to your workspace.</p>
          </header>

          <form onSubmit={handleSubmit}>
            {location.state?.notice && (
              <div className="auth-alert auth-alert-success">{location.state.notice}</div>
            )}

            {!mfaChallenge && <div className="form-group">
              <label htmlFor="login-email">Email address</label>
              <input
                id="login-email"
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="e.g. you@school.edu"
                required
                autoComplete="email"
                autoFocus
              />
            </div>}

            {!mfaChallenge && <div className="form-group">
              <label htmlFor="login-password">Password</label>
              <div className="auth-password-field">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>}

            {mfaChallenge && (
              <div className="form-group">
                <label htmlFor="login-mfa">Authenticator code</label>
                <input id="login-mfa" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  pattern="[0-9]{6}" required autoFocus value={mfaCode}
                  onChange={event => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit authenticator code" />
                <p className="section-sub">Enter the six-digit code from your authenticator app.</p>
              </div>
            )}

            {!mfaChallenge && <div className="auth-forgot"><Link to="/forgot-password">Forgot password?</Link></div>}

            {error && <div className="auth-alert auth-alert-danger" role="alert">{error}</div>}

            <button type="submit" disabled={loading} className="btn-primary auth-submit">
              {loading ? 'Verifying…' : mfaChallenge ? 'Verify code' : 'Sign in'}
            </button>
            {mfaChallenge && (
              <button type="button" className="action-btn action-btn-gray" style={{ width: '100%', marginTop: '.75rem' }}
                onClick={() => { setMfaChallenge(''); setMfaCode(''); setError(''); }}>Use another account</button>
            )}
          </form>

          <div className="auth-register">
            Don&apos;t have an account? <Link to="/register">Register</Link>
          </div>
        </div>
      </section>
    </main>
  );
};

export default Login;
