import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import BrandLogo from '../../components/common/BrandLogo';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import useAuth from '../../hooks/useAuth';
import { MAX_PHONE_DIGITS, sanitizePhone } from '../../utils/phone';

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

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: name === 'phone' ? sanitizePhone(value) : value });
  };

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
        <p className="auth-tagline">Create your student account and track live OJT progress.</p>
      </section>

      <section className="auth-form-panel">
        <div className="auth-card auth-register-card">
          <header className="auth-card-header">
            <h2>Create your account</h2>
            <p>Register as a student to access your OJT workspace.</p>
          </header>

          <form onSubmit={handleSubmit}>
          <p className="auth-section-label">Your name</p>
          <div className="mobile-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label htmlFor="register-first-name">First name</label>
              <input
                id="register-first-name"
                type="text" name="firstName"
                value={form.firstName} onChange={handleChange}
                placeholder="Juan" required autoComplete="given-name"
              />
            </div>
            <div className="form-group">
              <label htmlFor="register-last-name">Last name</label>
              <input
                id="register-last-name"
                type="text" name="lastName"
                value={form.lastName} onChange={handleChange}
                placeholder="Dela Cruz" required autoComplete="family-name"
              />
            </div>
          </div>

          <p className="auth-section-label">Contact</p>
          <div className="form-group">
            <label htmlFor="register-email">Email address</label>
            <input
              id="register-email"
              type="email" name="email"
              value={form.email} onChange={handleChange}
              placeholder="you@school.edu" required autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="register-phone">Phone <em>optional</em></label>
            <input
              id="register-phone"
              type="tel" name="phone" inputMode="numeric" autoComplete="tel"
              maxLength={MAX_PHONE_DIGITS}
              value={form.phone} onChange={handleChange}
              placeholder="09XXXXXXXXX"
            />
          </div>
          {/* Public registration creates student accounts only. */}
          <p className="auth-section-label">School <em>optional</em></p>
    <div className="form-group">
      <label htmlFor="register-course" className="sr-only">College / Course</label>
      <select id="register-course" name="course" value={form.course || ''} onChange={handleChange} autoComplete="organization-title">
        <option value="">Select your course</option>
        <option value="CCS - College of Computer Studies">CCS - Computer Studies</option>
        <option value="CCJE - College of Criminal Justice Education">CCJE - Criminal Justice</option>
        <option value="CBE - College of Business Education">CBE - Business</option>
        <option value="CTE - College of Teacher Education">CTE - Teacher Education</option>
        <option value="Psychology">Psychology</option>
      </select>
    </div>

    <div className="form-group">
      <label htmlFor="register-school" className="sr-only">School / University</label>
      <input id="register-school" type="text" name="school" value={form.school || ''}
        onChange={handleChange} autoComplete="organization"
        placeholder="School / University" />
    </div>
          <p className="auth-section-label">Password</p>
          <div className="form-group">
            <label htmlFor="register-password" className="sr-only">Password</label>
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
            <label htmlFor="register-confirm-password" className="sr-only">Confirm Password</label>
            <div className="auth-password-field">
              <input id="register-confirm-password" type={showConfirmPassword ? 'text' : 'password'} name="confirmPassword"
                value={form.confirmPassword} onChange={handleChange} placeholder="Repeat your password"
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
