import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import BrandLogo from '../../components/common/BrandLogo';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import useAuth from '../../hooks/useAuth';

const Register = () => {
  const navigate = useNavigate();
  const { register } = useAuth();

  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '',
    password: '', confirmPassword: '', phone: '',
    course: '', school: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword)
      return setError('Passwords do not match.');

    if (form.password.length < 8)
      return setError('Password must be at least 8 characters.');

    setLoading(true);
    try {
      const registration = { ...form };
      delete registration.confirmPassword;
      const result = await register(registration);
      navigate('/login', { replace: true, state: { notice: result.message } });
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed. Please try again.');
      setLoading(false);
    }
  };

  return (
    <main className="auth-layout auth-layout-register">
      {loading && <LoadingSpinner message="Creating your account" />}
      <section className="auth-brand-panel" aria-label="Smartrack introduction">
        <div className="auth-brand">
          <BrandLogo className="auth-brand-lockup" size="lg" />
        </div>
        <h1>Create your student account and start recording live OJT progress.</h1>
      </section>

      <section className="auth-form-panel">
        <div className="auth-card auth-register-card">
          <div className="auth-mobile-brand">
            <BrandLogo className="auth-brand-lockup" size="lg" />
          </div>

          <header className="auth-card-header">
            <h2>Create your account</h2>
            <p>Register as a student to access your OJT workspace.</p>
          </header>

          <form onSubmit={handleSubmit}>
          {/* Name Row */}
          <div className="mobile-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label htmlFor="register-first-name">First name</label>
              <input
                id="register-first-name"
                type="text" name="firstName"
                value={form.firstName} onChange={handleChange}
                placeholder="e.g. Jana" required
              />
            </div>
            <div className="form-group">
              <label htmlFor="register-last-name">Last name</label>
              <input
                id="register-last-name"
                type="text" name="lastName"
                value={form.lastName} onChange={handleChange}
                placeholder="e.g. Delgado" required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="register-email">Email address</label>
            <input
              id="register-email"
              type="email" name="email"
              value={form.email} onChange={handleChange}
              placeholder="e.g. jana.delgado@school.edu" required autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="register-phone">Phone (optional)</label>
            <input
              id="register-phone"
              type="tel" name="phone"
              value={form.phone} onChange={handleChange}
              placeholder="09XX XXX XXXX"
            />
          </div>
          {/* Public registration creates student accounts only. */}
    <div className="form-group">
      <label htmlFor="register-course">College / Course</label>
      <select id="register-course" name="course" value={form.course || ''} onChange={handleChange}>
        <option value="">Select your college or course</option>
        <option value="CCS - College of Computer Studies">CCS - College of Computer Studies</option>
        <option value="CCJE - College of Criminal Justice Education">CCJE - College of Criminal Justice Education</option>
        <option value="CBE - College of Business Education">CBE - College of Business Education</option>
        <option value="CTE - College of Teacher Education">CTE - College of Teacher Education</option>
        <option value="Psychology">Psychology</option>
      </select>
    </div>

    <div className="form-group">
      <label htmlFor="register-school">School / University</label>
      <input id="register-school" type="text" name="school" value={form.school || ''}
        onChange={handleChange}
        placeholder="e.g. University of Example" />
    </div>
          <div className="form-group">
            <label htmlFor="register-password">Password</label>
            <div className="auth-password-field">
              <input id="register-password" type={showPassword ? 'text' : 'password'} name="password"
                value={form.password} onChange={handleChange} placeholder="At least 8 characters"
                required autoComplete="new-password" />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="register-confirm-password">Confirm Password</label>
            <div className="auth-password-field">
              <input id="register-confirm-password" type={showConfirmPassword ? 'text' : 'password'} name="confirmPassword"
                value={form.confirmPassword} onChange={handleChange} placeholder="Type the same password again"
                required autoComplete="new-password" />
              <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'} aria-pressed={showConfirmPassword}>
                {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          {error && <div className="auth-alert auth-alert-danger" role="alert">{error}</div>}

          <button type="submit" disabled={loading} className="btn-primary auth-submit">
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

          <div className="auth-register">
            Already have an account? <Link to="/login">Sign in</Link>
          </div>
        </div>
      </section>
    </main>
  );
};

export default Register;
