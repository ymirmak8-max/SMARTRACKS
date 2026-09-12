import { useState, useEffect, useCallback } from 'react';
import { getProfile, updateProfile, changePassword } from '../../api/profile';
import NotificationPreferences from '../../components/common/NotificationPreferences';
import SkeletonPage from '../../components/common/Skeleton';
import { MAX_PHONE_DIGITS, sanitizePhone } from '../../utils/phone';
import ProfileAvatar from '../../components/common/ProfileAvatar';

const ROLE_LABELS = {
  student: 'Student',
  coordinator: 'Coordinator',
  supervisor: 'Supervisor',
  admin: 'Admin',
};

const COURSES = [
  'CCS - College of Computer Studies',
  'CCJE - College of Criminal Justice Education',
  'CBE - College of Business Education',
  'CTE - College of Teacher Education',
  'Psychology',
];

const ProfilePage = () => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', course: '', school: '',
  });
  const [formLoading, setFormLoading] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '', newPassword: '', confirmPassword: '',
  });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');
  const [error, setError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const showToast = useCallback((msg, type = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 6000);
  }, []);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getProfile();
      setProfile(res.data.user);
      setForm({
        firstName: res.data.user.first_name,
        lastName: res.data.user.last_name,
        phone: res.data.user.phone || '',
        course: res.data.user.course || '',
        school: res.data.user.school || '',
      });
    } catch { showToast('Failed to load profile.', 'error'); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setError('');
    setFormLoading(true);
    try {
      const res = await updateProfile(form);
      setProfile(res.data.user);
      setEditMode(false);
      showToast('Profile updated successfully.');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update profile.');
    } finally { setFormLoading(false); }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    if (passwordForm.newPassword !== passwordForm.confirmPassword)
      return setPasswordError('Passwords do not match.');
    setPasswordLoading(true);
    try {
      await changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setShowPasswordForm(false);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      showToast('Password changed successfully.');
    } catch (err) {
      setPasswordError(err.response?.data?.message || 'Failed to change password.');
    } finally { setPasswordLoading(false); }
  };

  const initials = profile
    ? `${profile.first_name?.[0] || ''}${profile.last_name?.[0] || ''}`.toUpperCase()
    : '??';

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  }) : '—';

  if (loading) return (
    <SkeletonPage variant="profile" label="Loading profile" />
  );

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <div className="section-title">Account</div>
        <div className="section-sub">Manage your profile and preferences</div>
      </div>

      {/* Profile Header Card */}
      <div className="card" style={{ marginBottom: '0.875rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <ProfileAvatar initials={initials} onToast={showToast} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>
              {profile.first_name} {profile.last_name}
            </div>
            <div style={{ color: 'var(--text-3)', fontSize: '0.82rem', marginTop: '0.1rem' }}>
              {profile.email}
            </div>
            <span className="badge badge-primary" style={{ marginTop: '0.4rem', fontSize: '0.72rem' }}>
              {ROLE_LABELS[profile.role] || profile.role}
            </span>
          </div>
          {!editMode && (
            <button onClick={() => setEditMode(true)} className="action-btn action-btn-primary" style={{ flexShrink: 0 }}>
              Edit
            </button>
          )}
        </div>
      </div>

      {/* OJT Info */}
      {(profile.course || profile.school) && !editMode && (
        <div className="card" style={{ marginBottom: '0.875rem' }}>
          <div className="card-title">OJT Information</div>
          {profile.course && (
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '0.75rem 0', borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ color: 'var(--text-3)', fontSize: '0.875rem' }}>Course</span>
              <span style={{ fontWeight: 500, fontSize: '0.875rem', textAlign: 'right', maxWidth: '65%' }}>{profile.course}</span>
            </div>
          )}
          {profile.school && (
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '0.75rem 0',
            }}>
              <span style={{ color: 'var(--text-3)', fontSize: '0.875rem' }}>School</span>
              <span style={{ fontWeight: 500, fontSize: '0.875rem', textAlign: 'right', maxWidth: '65%' }}>{profile.school}</span>
            </div>
          )}
        </div>
      )}

      {/* Edit Form */}
      {editMode && (
        <div className="card" style={{ marginBottom: '0.875rem' }}>
          <div className="card-title">Edit Profile</div>
          <form onSubmit={handleUpdateProfile}>
            <div className="grid-2">
              <div className="form-group">
                <label>First Name</label>
                <input type="text" required value={form.firstName}
                  onChange={e => setForm({ ...form, firstName: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Last Name</label>
                <input type="text" required value={form.lastName}
                  onChange={e => setForm({ ...form, lastName: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input type="tel" inputMode="numeric" autoComplete="tel" maxLength={MAX_PHONE_DIGITS}
                value={form.phone}
                onChange={e => setForm({ ...form, phone: sanitizePhone(e.target.value) })}
                placeholder="09XXXXXXXXX" />
            </div>
            <div className="form-group">
              <label>Course</label>
              <select value={form.course} onChange={e => setForm({ ...form, course: e.target.value })}>
                <option value="">Select course...</option>
                {COURSES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>School / University</label>
              <input type="text" value={form.school}
                onChange={e => setForm({ ...form, school: e.target.value })}
                placeholder="e.g. University of Example" />
            </div>
            {error && <p className="error-message">{error}</p>}
            <div className="grid-2">
              <button type="button" onClick={() => { setEditMode(false); setError(''); }}
                className="action-btn action-btn-gray" style={{ padding: '0.75rem' }}>Cancel</button>
              <button type="submit" disabled={formLoading} className="btn-primary" style={{ margin: 0 }}>
                {formLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Account Info */}
      {!editMode && (
        <div className="card" style={{ marginBottom: '0.875rem' }}>
          <div className="card-title">Additional details</div>
          {[
            { label: 'Phone', value: profile.phone || 'Not set' },
            { label: 'Company', value: profile.company_name || 'Not assigned' },
            { label: 'Company address', value: profile.company_address || 'Not set' },
            { label: 'Course', value: profile.course || 'Not set' },
            { label: 'School', value: profile.school || 'Not set' },
            { label: 'Member since', value: formatDate(profile.created_at) },
          ].map(item => (
            <div key={item.label} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '0.75rem 0', borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ color: 'var(--text-3)', fontSize: '0.875rem' }}>{item.label}</span>
              <span style={{ fontWeight: 500, fontSize: '0.875rem', color: 'var(--text)', textAlign: 'right', maxWidth: '60%' }}>
                {item.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Change Password */}
      <div className="card" style={{ marginBottom: '0.875rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showPasswordForm ? '1rem' : 0 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Password</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: '0.1rem' }}>
              Keep your account secure
            </div>
          </div>
          {!showPasswordForm && (
            <button onClick={() => setShowPasswordForm(true)} className="action-btn action-btn-warning">
              Change
            </button>
          )}
        </div>

        {showPasswordForm && (
          <form onSubmit={handleChangePassword}>
            <div className="form-group">
              <label>Current Password</label>
              <input type="password" required value={passwordForm.currentPassword}
                onChange={e => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                placeholder="Type your current password" />
            </div>
            <div className="form-group">
              <label>New Password</label>
              <input type="password" required value={passwordForm.newPassword}
                onChange={e => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                placeholder="New password, at least 6 characters" />
            </div>
            <div className="form-group">
              <label>Confirm New Password</label>
              <input type="password" required value={passwordForm.confirmPassword}
                onChange={e => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                placeholder="Type the new password again" />
            </div>
            {passwordError && <p className="error-message">{passwordError}</p>}
            <div className="grid-2">
              <button type="button" onClick={() => { setShowPasswordForm(false); setPasswordError(''); }}
                className="action-btn action-btn-gray" style={{ padding: '0.75rem' }}>Cancel</button>
              <button type="submit" disabled={passwordLoading} className="btn-primary" style={{ margin: 0 }}>
                {passwordLoading ? 'Changing...' : 'Change Password'}
              </button>
            </div>
          </form>
        )}
      </div>

      <NotificationPreferences />

      {toast && (
        <div className={`toast ${toastType === 'error' ? 'toast-error' : ''}`}>{toast}</div>
      )}
    </div>
  );
};

export default ProfilePage;
