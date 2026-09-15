import { expect, test } from '@playwright/test';

const json = (route, body, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const expectResponsiveControls = async (page) => {
  const audit = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const controls = [...document.querySelectorAll(
      '.btn, .btn-primary, .btn-secondary, .btn-outline, .action-btn, .btn-compact-primary'
    )].filter(element => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });

    return {
      viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      invalid: controls.map(element => {
        const rect = element.getBoundingClientRect();
        return {
          text: element.textContent.trim(),
          height: rect.height,
          left: rect.left,
          right: rect.right,
          clipsText: element.scrollWidth > element.clientWidth + 1,
        };
      }).filter(control => control.height < 41 || control.left < -1
        || control.right > viewportWidth + 1 || control.clipsText),
    };
  });

  expect(audit.documentWidth).toBeLessThanOrEqual(audit.viewportWidth + 1);
  expect(audit.invalid).toEqual([]);
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/refresh', route => json(route, { message: 'No session' }, 401));
});

test('registration validates passwords before sending a request', async ({ page }) => {
  let submitted = false;
  await page.route('**/api/auth/register', route => {
    submitted = true;
    return json(route, { message: 'Registered' }, 201);
  });
  await page.goto('/register');
  await page.locator('input[name="firstName"]').fill('Test');
  await page.locator('input[name="lastName"]').fill('Student');
  await page.locator('input[name="email"]').fill('student@example.com');
  await page.locator('input[name="password"]').fill('password-one');
  await page.locator('input[name="confirmPassword"]').fill('password-two');
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page.getByText('Passwords do not match.')).toBeVisible();
  expect(submitted).toBe(false);
  await expectResponsiveControls(page);
});

test('student login restores the correct dashboard and attendance state', async ({ page }) => {
  const student = { id: 1, role: 'student', first_name: 'Test', last_name: 'Student',
    privacyNoticeVersion: 'test-v1' };
  let loggedIn = false;
  await page.unroute('**/api/auth/refresh');
  await page.route('**/api/auth/refresh', route => loggedIn
    ? json(route, { accessToken: 'test-token' })
    : json(route, { message: 'No session' }, 401));
  await page.route('**/api/auth/me', route => json(route, { user: student }));
  await page.route('**/api/auth/privacy-notice', route => json(route, {
    notice: { version: 'test-v1', effectiveDate: 'July 29, 2026' },
  }));
  await page.route('**/api/auth/login', route => {
    loggedIn = true;
    return json(route, { accessToken: 'test-token', user: student });
  });
  await page.route('**/api/dtr/today', route => json(route, { record: null }));
  await page.route('**/api/dtr/history', route => json(route, { records: [], totalRendered: 0, requiredHours: 486 }));
  await page.route('**/api/dtr/deployment-info', route => json(route, {
    deployment: { company_name: 'Test Company', latitude: 10.3, longitude: 123.9, geo_radius_meters: 100 },
  }));
  await page.route('**/api/notifications*', route => json(route, { notifications: [] }));
  await page.route('**/api/documents/my-documents', route => json(route, { documents: [] }));
  await page.route('**/api/attendance-exceptions/mine', route => json(route, { exceptions: [] }));
  await page.route('**/api/completions/mine', route => json(route, { completion: {
    id: 'deployment-1', rendered_hours: 0, required_hours: 486,
    required_documents: 1, approved_documents: 0, has_final_evaluation: false,
    ready: false, completion_status: 'not_requested',
  } }));
  await page.route(/\/api\/daily-tasks(\/mine)?(\?|$)/, route => json(route, {
    date: '2026-09-15',
    tasks: [{
      id: 'task-1', template_id: 'tpl-1', title: 'Submit work log', description: 'Log today’s duties',
      status: 'missing', student_notes: null, excuse_remarks: null,
    }],
    counts: { missing: 1, in_progress: 0, completed: 0, excused: 0 },
  }));

  await page.goto('/login');
  await page.getByLabel('Email address').fill('student@example.com');
  await page.locator('#login-password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/student/);
  await expect(page.getByText('Welcome back, Test')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Time In' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Time Out' })).toBeDisabled();

  const navigation = page.viewportSize().width <= 768 ? '.bottom-nav-item' : '.sidebar-item';
  await expect(page.getByText("Today's tasks")).toBeVisible();
  await page.locator(navigation).filter({ hasText: 'Docs' }).click();
  await expect(page).toHaveURL(/view=documents/);
  await expect(page.getByText('No document requirements yet')).toBeVisible();
  await page.locator(navigation).filter({ hasText: 'Tasks' }).click();
  await expect(page).toHaveURL(/view=tasks/);
  await expect(page.getByRole('heading', { name: 'Daily tasks' })).toBeVisible();
  await expect(page.getByText('Submit work log')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start task' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark completed' })).toBeVisible();
  await expectResponsiveControls(page);
  await page.locator(navigation).filter({ hasText: 'Requests' }).click();
  await expect(page.getByRole('heading', { name: 'Leave & corrections' })).toBeVisible();
  await page.locator(navigation).filter({ hasText: 'Completion' }).click();
  await expect(page.getByRole('heading', { name: 'Completion status' })).toBeVisible();
  await expectResponsiveControls(page);
  await page.goBack();
  await expect(page).toHaveURL(/view=attendance/);
  await page.locator(navigation).filter({ hasText: 'Home' }).click();
  await expect(page.getByText('Welcome back, Test')).toBeVisible();
  await expectResponsiveControls(page);
});

test('administrator dashboard stays within the viewport and health actions remain compact', async ({ page }) => {
  const admin = {
    id: '00000000-0000-4000-8000-000000000001', role: 'admin',
    first_name: 'System', last_name: 'Administrator', email: 'admin@example.com',
    privacyNoticeVersion: 'test-v1', mfaEnabled: true,
  };
  const student = {
    id: '00000000-0000-4000-8000-000000000002', role: 'student',
    first_name: 'Student', last_name: 'With A Very Long Family Name',
    email: 'student.with.a.long.address@example.edu', phone: '09123123123123',
    course: 'Bachelor of Science in Information Technology', is_active: true,
    approval_status: 'approved',
  };

  await page.addInitScript(() => {
    localStorage.setItem('smartrackSessionExpected', 'true');
    sessionStorage.setItem('splashShown', 'true');
  });
  await page.unroute('**/api/auth/refresh');
  await page.route('**/api/auth/refresh', route => json(route, { accessToken: 'admin-token' }));
  await page.route('**/api/auth/me', route => json(route, { user: admin }));
  await page.route('**/api/auth/privacy-notice', route => json(route, {
    notice: { version: 'test-v1', effectiveDate: 'August 3, 2026' },
  }));
  await page.route('**/api/users*', route => json(route, { users: [admin, student] }));
  await page.route('**/api/deployments/companies', route => json(route, { companies: [] }));
  await page.route('**/api/notifications*', route => json(route, { notifications: [] }));
  await page.route('**/api/system/health', route => json(route, {
    overall: 'healthy', responseTimeMs: 18, uptimeSeconds: 7200, services: {},
  }));
  await page.route('**/api/system/privacy', route => json(route, { settings: { imageRetentionDays: 90 } }));
  await page.route('**/api/system/events', route => json(route, { events: [] }));
  await page.route('**/api/system/attendance-policy', route => json(route, { policy: {
    selfieRequired: true, maximumGpsAccuracyMeters: 100, unpaidBreakMinutes: 60,
    maximumCreditedHours: 8, offlineSubmissionHours: 24,
  } }));
  await page.route('**/api/system/backups', route => json(route, { status: 'verified', latest: null }));
  await page.route('**/api/documents/requirements', route => json(route, { requirements: [
    { id: 'requirement-1', name: 'Résumé', description: 'Current résumé', is_required: true, is_active: true, sort_order: 10 },
    { id: 'requirement-2', name: 'Old Form', description: '', is_required: false, is_active: false, sort_order: 20 },
  ] }));

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'User management' })).toBeVisible();
  await expectResponsiveControls(page);
  await expect(page.getByText(student.email)).toBeVisible();

  const navigation = page.viewportSize().width <= 768 ? '.bottom-nav-item' : '.sidebar-item';
  await page.locator(navigation).filter({ hasText: 'Document Requirements' }).click();
  await expect(page.getByRole('heading', { name: 'Document requirements' })).toBeVisible();
  await expect(page.getByText('Résumé', { exact: true })).toBeVisible();
  await expectResponsiveControls(page);

  await page.locator(navigation).filter({ hasText: 'System Health' }).click();
  await expect(page.getByRole('heading', { name: 'System health' })).toBeVisible();
  await expectResponsiveControls(page);

  const refreshBox = await page.getByRole('button', { name: 'Refresh' }).boundingBox();
  expect(refreshBox.width).toBeLessThan(140);
});

for (const dashboard of [
  { role: 'coordinator', path: '/coordinator', heading: 'Coordinator workspace' },
  { role: 'supervisor', path: '/supervisor', heading: 'My students' },
]) {
  test(`${dashboard.role} dashboard renders without responsive overflow`, async ({ page }) => {
    const roleUser = {
      id: `test-${dashboard.role}`, role: dashboard.role,
      first_name: 'Test', last_name: dashboard.role,
      email: `${dashboard.role}@example.edu`, privacyNoticeVersion: 'test-v1',
    };

    await page.addInitScript(() => {
      localStorage.setItem('smartrackSessionExpected', 'true');
      sessionStorage.setItem('splashShown', 'true');
    });
    await page.unroute('**/api/auth/refresh');
    await page.route('**/api/auth/refresh', route => json(route, { accessToken: 'role-token' }));
    await page.route('**/api/auth/me', route => json(route, { user: roleUser }));
    await page.route('**/api/auth/privacy-notice', route => json(route, {
      notice: { version: 'test-v1', effectiveDate: 'August 3, 2026' },
    }));
    await page.route('**/api/notifications*', route => json(route, { notifications: [] }));
    await page.route('**/api/coordinator/students', route => json(route, { students: [] }));
    await page.route('**/api/coordinator/anomalies', route => json(route, { anomalies: [] }));
    await page.route('**/api/coordinator/announcements', route => json(route, { announcements: [] }));
    await page.route('**/api/deployments**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith('/companies')) return json(route, { companies: [] });
      if (pathname.endsWith('/options')) return json(route, { students: [], coordinators: [], supervisors: [] });
      return json(route, { deployments: [] });
    });
    await page.route('**/api/evaluations/my-students', route => json(route, { students: [] }));
    await page.route('**/api/coordinator/attendance-review', route => json(route, { records: [] }));
    await page.route('**/api/dtr/live-locations', route => json(route, { locations: [] }));
    await page.route('**/api/analytics/overview', route => json(route, {
      stats: { totalStudents: 0, avgProgress: 0, atRisk: 0 },
      analysis: 'No active students are currently available for analysis.',
    }));
    await page.route('**/api/analytics/risks', route => json(route, { students: [] }));
    await page.route('**/api/attendance-exceptions/requests', route => json(route, { requests: [] }));
    await page.route('**/api/attendance-exceptions/calendar', route => json(route, { exceptions: [] }));
    await page.route('**/api/completions', route => json(route, { completions: [] }));
    await page.route('**/api/documents/requirements', route => json(route, { requirements: [] }));
    await page.route(/\/api\/daily-tasks(\/mine)?(\?|$)/, route => json(route, {
      date: '2026-09-15',
      tasks: [{
        id: 'assignment-1', template_id: 'template-1', title: 'Submit work log', description: '',
        status: 'missing', first_name: 'Ana', last_name: 'Cruz', email: 'ana@example.edu',
      }],
      counts: { missing: 1, in_progress: 0, completed: 0, excused: 0 },
    }));

    await page.goto(dashboard.path);
    await expect(page.getByRole('heading', { name: dashboard.heading })).toBeVisible();
    await expectResponsiveControls(page);

    const navigation = page.viewportSize().width <= 768 ? '.bottom-nav-item' : '.sidebar-item';
    const openNavigation = async label => {
      const direct = page.locator(navigation).filter({ hasText: label });
      if (await direct.count()) return direct.click();
      await page.locator('.bottom-nav-item').filter({ hasText: 'More' }).click();
      return page.getByRole('menuitem', { name: label, exact: true }).click();
    };
    if (dashboard.role === 'supervisor') {
      await openNavigation('Tasks');
      await expect(page.getByRole('heading', { name: 'Daily tasks' })).toBeVisible();
      await expect(page.getByText('Ana Cruz')).toBeVisible();
      await expect(page.getByText('missing', { exact: true })).toBeVisible();
      await openNavigation('Map');
      await expect(page.getByText('Live map', { exact: true })).toBeVisible();
      await openNavigation('Attendance');
      await expect(page.getByRole('heading', { name: 'Attendance Review Center' })).toBeVisible();
    } else {
      for (const view of [
        ['Insights', 'Insights'], ['Reviews', 'Review center'],
        ['Announcements', 'Announcements'],
      ]) {
        await openNavigation(view[0]);
        await expect(page.getByRole('heading', { name: view[1], exact: true })).toBeVisible();
        await expectResponsiveControls(page);
      }
      const requirementsLabel = page.viewportSize().width <= 768 ? 'Requirements' : 'Document Requirements';
      await openNavigation(requirementsLabel);
      await expect(page.getByRole('heading', { name: 'Document requirements' })).toBeVisible();
      await expectResponsiveControls(page);
    }
  });
}
