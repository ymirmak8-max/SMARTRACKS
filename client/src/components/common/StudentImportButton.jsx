import { useRef, useState } from 'react';
import { importStudents } from '../../api/users';

const parseCsvLine = (line, delimiter) => {
  const cells = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { cells.push(value.trim()); value = ''; }
    else value += char;
  }
  cells.push(value.trim());
  return cells;
};

const detectDelimiter = (header) => {
  const candidates = [',', ';', '\t'];
  return candidates.reduce((best, candidate) => (
    parseCsvLine(header, candidate).length > parseCsvLine(header, best).length ? candidate : best
  ), ',');
};

const HEADER_ALIASES = {
  firstname: 'firstName',
  givenname: 'firstName',
  lastname: 'lastName',
  surname: 'lastName',
  familyname: 'lastName',
  email: 'email',
  emailaddress: 'email',
  phone: 'phone',
  phonenumber: 'phone',
  contactnumber: 'phone',
  mobilenumber: 'phone',
  course: 'course',
  program: 'course',
  school: 'school',
  institution: 'school',
};

const TEMPLATE = `first_name,last_name,email,phone,course,school
First,Last,student@school.edu,09XXXXXXXXX,Course,School`;

const downloadCsv = (contents, fileName) => {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

const parseCsv = (text) => {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error('CSV must include a header and at least one student.');
  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map((value) => {
    const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
    return HEADER_ALIASES[normalized] || normalized;
  });
  const missing = [
    ['firstName', 'first name'],
    ['lastName', 'last name'],
    ['email', 'email'],
  ].filter(([key]) => !headers.includes(key)).map(([, label]) => label);
  if (missing.length) {
    throw new Error(
      `Missing required column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}. `
      + 'Use headers: first_name,last_name,email,phone,course,school.',
    );
  }
  return lines.slice(1).map(line => Object.fromEntries(
    parseCsvLine(line, delimiter).map((value, index) => [headers[index], value]),
  ));
};

const StudentImportButton = ({ onImported }) => {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [previewRows, setPreviewRows] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setErrorMessage('');
    try {
      const rows = parseCsv(await file.text());
      const preview = await importStudents({ rows, dryRun: true });
      if (!preview.data.valid) throw new Error(preview.data.errors.map(item => `Row ${item.row}: ${item.message}`).join('\n'));
      setPreviewRows(rows);
    } catch (error) {
      setErrorMessage(error.response?.data?.errors?.map(item => `Row ${item.row}: ${item.message}`).join('\n')
        || error.response?.data?.message || error.message);
    } finally { setBusy(false); }
  };

  const confirmImport = async () => {
    setBusy(true);
    setErrorMessage('');
    try {
      const response = await importStudents({ rows: previewRows, dryRun: false });
      const credentials = ['email,temporary_password',
        ...response.data.students.map(student => `${student.email},${student.temporaryPassword}`)].join('\n');
      downloadCsv(credentials, 'smartrack-imported-student-credentials.csv');
      setPreviewRows([]);
      onImported?.(response.data.message);
    } catch (error) {
      setErrorMessage(error.response?.data?.message || error.message);
    } finally { setBusy(false); }
  };

  return (
    <>
      <input ref={inputRef} hidden type="file" accept=".csv,text/csv" onChange={handleFile} />
      <button type="button" className="action-btn action-btn-gray"
        onClick={() => downloadCsv(TEMPLATE, 'smartrack-student-import-template.csv')}>
        Download template
      </button>
      <button className="btn-compact-primary" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Importing…' : 'Import CSV'}
      </button>
      {errorMessage && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-content" role="alertdialog" aria-modal="true" aria-labelledby="import-error-title">
            <h2 id="import-error-title">CSV could not be imported</h2>
            <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '50vh', overflow: 'auto' }}>{errorMessage}</pre>
            <button type="button" className="btn-compact-primary" onClick={() => setErrorMessage('')}>Close</button>
          </div>
        </div>
      )}
      {previewRows.length > 0 && (
        <div className="modal-overlay" role="presentation">
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="import-preview-title">
            <h2 id="import-preview-title">Review student import</h2>
            <p>{previewRows.length} validated student account{previewRows.length === 1 ? '' : 's'} will be created.</p>
            <div className="table-wrapper" style={{ maxHeight: '50vh', overflow: 'auto' }}>
              <table>
                <thead><tr><th>Name</th><th>Email</th><th>Course</th><th>School</th></tr></thead>
                <tbody>{previewRows.map((row, index) => (
                  <tr key={`${row.email}-${index}`}>
                    <td>{row.firstName} {row.lastName}</td>
                    <td>{row.email}</td>
                    <td>{row.course || '—'}</td>
                    <td>{row.school || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="action-btn action-btn-gray" disabled={busy}
                onClick={() => setPreviewRows([])}>Cancel</button>
              <button type="button" className="btn-compact-primary" disabled={busy} onClick={confirmImport}>
                {busy ? 'Importing…' : `Import ${previewRows.length} students`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StudentImportButton;
