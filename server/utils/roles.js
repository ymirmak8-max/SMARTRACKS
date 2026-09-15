export const APP_ROLES = ['student', 'coordinator', 'supervisor'];

export const toAppRole = (role) => {
  const value = String(role || '').trim().toLowerCase();
  return value === 'admin' ? 'coordinator' : value;
};

export const seesAllAssignments = (role) => toAppRole(role) === 'coordinator';
