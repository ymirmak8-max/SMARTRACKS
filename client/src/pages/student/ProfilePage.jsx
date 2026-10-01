import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogOut, Moon, Sun } from 'lucide-react';
import { getProfile, updateProfile, changePassword } from '../../api/profile';
import { getStudentMeta, saveStudentMeta } from '../../utils/studentMeta';
import { useTheme } from '../../context/ThemeContext';
import useAuth from '../../hooks/useAuth';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import SkeletonPage from '../../components/common/Skeleton';
import { MAX_PHONE_DIGITS, sanitizePhone } from '../../utils/phone';
import ProfileAvatar from '../../components/common/ProfileAvatar';
import VectorIcon from '../../components/common/VectorIcon';

const ROLE_LABELS = {
  student: 'Student',
  coordinator: 'Coordinator',
  supervisor: 'Supervisor',
};

const COURSES = [
  'CCS - College of Computer Studies',
  'CCJE - College of Criminal Justice Education',
  'CBE - College of Business Education',
  'CTE - College of Teacher Education',
  'Psychology',
];

const ProfilePage = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', course: '', school: '', yearLevel: '', section: '',
  });
  const [formLoading, setFormLoading] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '', newPassword: '', confirmPassword: '',
  });
  const [visiblePasswords, setVisiblePasswords] = useState({ current: false, next: false, confirm: false });
  const togglePasswordVisible = (key) => setVisiblePasswords(current => ({ ...current, [key]: !current[key] }));
  const [passwordLoading, setPasswordLoading] = useState(false);
const [confirmLogout, setConfirmLogout] = useState(false);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');
  const [error, setError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const pickerRef = useRef(null);

  const showToast = useCallback((msg, type = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 6000);
  }, []);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getProfile();
      setProfile(res.data.user);
      const meta = getStudentMeta(res.data.user.id);
      setForm({
        firstName: res.data.user.first_name,
        lastName: res.data.user.last_name,
        phone: res.data.user.phone || '',
        course: res.data.user.course || '',
        school: res.data.user.school || '',
        yearLevel: meta.yearLevel,
        section: meta.section,
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
      saveStudentMeta(res.data.user.id, { yearLevel: form.yearLevel, section: form.section });
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

  const metaLine = [form.yearLevel, form.section].filter(Boolean).join(' · ');

  return (
    <div className="profile-page">
      {/* Identity — name left, photo top-right */}
      <section id="profile-section" className="card profile-identity" aria-label="Your identity">
        <div className="profile-identity-copy">
          <div className="profile-identity-name">
            {profile.first_name} {profile.last_name}
          </div>
          <div className="profile-identity-email">{profile.email}</div>
          <div className="profile-identity-badges">
            <span className="badge badge-primary">{ROLE_LABELS[profile.role] || profile.role}</span>
            {metaLine && <span className="badge badge-gray">{metaLine}</span>}
            {!editMode && (
              <button
                type="button"
                className="action-btn action-btn-primary profile-badge-edit"
                onClick={() => {
                  setEditMode(true);
                  window.setTimeout(() => {
                    pickerRef.current?.();
                    document.getElementById('edit-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 120);
                }}
              >
                Edit
              </button>
            )}
          </div>
        </div>
        <div className="profile-identity-side">
          <ProfileAvatar
            initials={initials}
            onToast={showToast}
            stackActions
            photoEditable={editMode}
            pickerRef={pickerRef}
          />
        </div>
      </section>

      {/* Edit Form */}
      {editMode && (
        <div id="edit-section" className="card profile-card edit-card">
          <div className="edit-card-head">
            <span className="edit-card-icon" aria-hidden="true"><VectorIcon name="pencil" size={17} /></span>
            <div>
              <div className="edit-card-title">Edit profile</div>
              <div className="edit-card-sub">Changes show across your dashboard right away.</div>
            </div>
          </div>
          <form onSubmit={handleUpdateProfile}>
            <p className="edit-group-label"><VectorIcon name="user" size={13} /> Name</p>
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
            <p className="edit-group-label"><VectorIcon name="phone" size={13} /> Contact</p>
            <div className="form-group">
              <label>Phone</label>
              <input type="tel" inputMode="numeric" autoComplete="tel" maxLength={MAX_PHONE_DIGITS}
                value={form.phone}
                onChange={e => setForm({ ...form, phone: sanitizePhone(e.target.value) })}
                placeholder="09XXXXXXXXX" />
            </div>
            <p className="edit-group-label"><VectorIcon name="school" size={13} /> School</p>
            <div className="form-group">
              <label>Course</label>
              <select value={form.course} onChange={e => setForm({ ...form, course: e.target.value })}>
                <option value="">Select course...</option>
                {COURSES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label>Year level</label>
                <input type="text" value={form.yearLevel}
                  onChange={e => setForm({ ...form, yearLevel: e.target.value })}
                  placeholder="e.g. 3rd Year" maxLength={30} />
              </div>
              <div className="form-group">
                <label>Section</label>
                <input type="text" value={form.section}
                  onChange={e => setForm({ ...form, section: e.target.value })}
                  placeholder="e.g. BSIT-3A" maxLength={30} />
              </div>
            </div>
            <div className="form-group">
              <label>School / University</label>
              <input type="text" value={form.school}
                onChange={e => setForm({ ...form, school: e.target.value })}
                placeholder="e.g. University of Example" />
            </div>
            {error && <p className="error-message">{error}</p>}
            <div className="grid-2 profile-form-actions">
              <button type="button" onClick={() => { setEditMode(false); setError(''); }}
                className="action-btn action-btn-gray">Cancel</button>
              <button type="submit" disabled={formLoading} className="btn-primary" style={{ margin: 0 }}>
                {formLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Details — single list, no duplicates */}
      {!editMode && (
        <div className="card profile-card">
          <div className="card-title">Details</div>
          {[
            { label: 'Phone', value: profile.phone || 'Not set' },
            { label: 'Year & Section', value: metaLine || 'Not set' },
            { label: 'Course', value: profile.course || 'Not set' },
            { label: 'School', value: profile.school || 'Not set' },
            { label: 'Company', value: profile.company_name || 'Not assigned' },
            { label: 'Company address', value: profile.company_address || 'Not set' },
            { label: 'Member since', value: formatDate(profile.created_at) },
          ].map(item => (
            <div key={item.label} className="profile-row">
              <span className="profile-row-label">{item.label}</span>
              <span className="profile-row-value">{item.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Security */}
      <div id="security-section" className="card profile-card edit-card">
        <div className="edit-card-head">
          <span className="edit-card-icon" aria-hidden="true"><VectorIcon name="lock" size={17} /></span>
          <div>
            <div className="edit-card-title">Password & security</div>
            <div className="edit-card-sub">Keep your account secure.</div>
          </div>
          {!showPasswordForm && (
            <button onClick={() => setShowPasswordForm(true)} className="action-btn action-btn-warning profile-security-btn">
              Change
            </button>
          )}
        </div>

        {showPasswordForm && (
          <form onSubmit={handleChangePassword}>
            <div className="form-group">
              <label>Current Password</label>
              <div className="auth-password-field">
                <input type={visiblePasswords.current ? 'text' : 'password'} required value={passwordForm.currentPassword}
                  onChange={e => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  placeholder="Type your current password" />
                <button type="button" onClick={() => togglePasswordVisible('current')}
                  aria-label={visiblePasswords.current ? 'Hide password' : 'Show password'} aria-pressed={visiblePasswords.current}>
                  {visiblePasswords.current ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>New Password</label>
              <div className="auth-password-field">
                <input type={visiblePasswords.next ? 'text' : 'password'} required value={passwordForm.newPassword}
                  onChange={e => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  placeholder="New password, at least 6 characters" />
                <button type="button" onClick={() => togglePasswordVisible('next')}
                  aria-label={visiblePasswords.next ? 'Hide password' : 'Show password'} aria-pressed={visiblePasswords.next}>
                  {visiblePasswords.next ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>Confirm New Password</label>
              <div className="auth-password-field">
                <input type={visiblePasswords.confirm ? 'text' : 'password'} required value={passwordForm.confirmPassword}
                  onChange={e => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  placeholder="Type the new password again" />
                <button type="button" onClick={() => togglePasswordVisible('confirm')}
                  aria-label={visiblePasswords.confirm ? 'Hide password' : 'Show password'} aria-pressed={visiblePasswords.confirm}>
                  {visiblePasswords.confirm ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>
            {passwordError && <p className="error-message">{passwordError}</p>}
            <div className="grid-2 profile-form-actions">
              <button type="button" onClick={() => { setShowPasswordForm(false); setPasswordError(''); }}
                className="action-btn action-btn-gray">Cancel</button>
              <button type="submit" disabled={passwordLoading} className="btn-primary" style={{ margin: 0 }}>
                {passwordLoading ? 'Changing...' : 'Change Password'}
              </button>
            </div>
          </form>
        )}
      </div>

      <div id="appearance-section" className="card profile-card edit-card">
        <div className="edit-card-head">
          <span className="edit-card-icon" aria-hidden="true">{theme === 'light' ? <Sun size={17} /> : <Moon size={17} />}</span>
          <div>
            <div className="edit-card-title">Appearance</div>
            <div className="edit-card-sub">Light or dark mode.</div>
          </div>
        </div>
        <div className="profile-theme-seg" role="group" aria-label="Appearance">
          <button
            type="button"
            className={`profile-theme-btn${theme === 'light' ? ' is-on' : ''}`}
            aria-pressed={theme === 'light'}
            onClick={() => theme !== 'light' && toggleTheme()}
          >
            <Sun size={15} /> Light
          </button>
          <button
            type="button"
            className={`profile-theme-btn${theme === 'dark' ? ' is-on' : ''}`}
            aria-pressed={theme === 'dark'}
            onClick={() => theme !== 'dark' && toggleTheme()}
          >
            <Moon size={15} /> Dark
          </button>
        </div>
      </div>

      <button
        type="button"
        className="profile-signout"
        onClick={() => setConfirmLogout(true)}
      >
        <LogOut size={16} /> Sign out
      </button>

      <ConfirmDialog
        open={confirmLogout}
        title="Sign out?"
        message="Are you sure you want to sign out?"
        confirmLabel="Sign out"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={async () => { setConfirmLogout(false); await logout(); navigate('/login', { replace: true }); }}
      />

      {toast && (
        <div className={`toast ${toastType === 'error' ? 'toast-error' : ''}`}>{toast}</div>
      )}
    </div>
  );
};

export default ProfilePage;
