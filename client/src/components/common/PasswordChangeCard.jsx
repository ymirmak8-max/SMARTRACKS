import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { changePassword } from '../../api/profile';

const PasswordChangeCard = ({ onToast }) => {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [visible, setVisible] = useState({ current: false, next: false, confirm: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const toggleVisible = (key) => setVisible((current) => ({ ...current, [key]: !current[key] }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (form.newPassword !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (form.newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      await changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setShowForm(false);
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      onToast?.('Password changed successfully.');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to change password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card profile-card edit-card no-side-accent" style={{ marginBottom: '.875rem' }}>
      <div className="edit-card-head">
        <div>
          <div className="edit-card-title">Password &amp; security</div>
          <div className="edit-card-sub">Keep your account secure.</div>
        </div>
        {!showForm && (
          <button type="button" onClick={() => setShowForm(true)} className="action-btn action-btn-warning profile-security-btn">
            Change
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Current Password</label>
            <div className="auth-password-field">
              <input
                type={visible.current ? 'text' : 'password'}
                required
                value={form.currentPassword}
                onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
                placeholder="Type your current password"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => toggleVisible('current')}
                aria-label={visible.current ? 'Hide password' : 'Show password'}
                aria-pressed={visible.current}
              >
                {visible.current ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>
          <div className="form-group">
            <label>New Password</label>
            <div className="auth-password-field">
              <input
                type={visible.next ? 'text' : 'password'}
                required
                value={form.newPassword}
                onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
                placeholder="New password, at least 8 characters"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => toggleVisible('next')}
                aria-label={visible.next ? 'Hide password' : 'Show password'}
                aria-pressed={visible.next}
              >
                {visible.next ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>
          <div className="form-group">
            <label>Confirm New Password</label>
            <div className="auth-password-field">
              <input
                type={visible.confirm ? 'text' : 'password'}
                required
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                placeholder="Type the new password again"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => toggleVisible('confirm')}
                aria-label={visible.confirm ? 'Hide password' : 'Show password'}
                aria-pressed={visible.confirm}
              >
                {visible.confirm ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>
          {error && <p className="error-message">{error}</p>}
          <div className="grid-2 profile-form-actions">
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(''); }}
              className="action-btn action-btn-gray"
            >
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary" style={{ margin: 0 }}>
              {loading ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default PasswordChangeCard;
