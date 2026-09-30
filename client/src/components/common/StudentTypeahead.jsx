import { useEffect, useId, useMemo, useRef, useState } from 'react';

const sortKey = (student) =>
  `${student.last_name || ''} ${student.first_name || ''}`.trim().toLowerCase();

const displayName = (student) =>
  `${student.first_name || ''} ${student.last_name || ''}`.trim() || student.email || 'Student';

const alphabetLabel = (student) => {
  const last = (student.last_name || '').trim();
  const first = (student.first_name || '').trim();
  if (last && first) return `${last}, ${first}`;
  return displayName(student);
};

const haystack = (student) =>
  `${student.first_name || ''} ${student.last_name || ''} ${student.email || ''} ${student.company_name || ''} ${student.student_id || ''}`.toLowerCase();

const StudentTypeahead = ({
  students = [],
  value,
  onChange,
  onSelect,
  label = 'Find student',
  placeholder = 'Type a name to see matching students',
  id,
}) => {
  const generatedId = useId();
  const inputId = id || generatedId;
  const listId = `${inputId}-list`;
  const wrapRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const sorted = useMemo(
    () => [...students].sort((a, b) => sortKey(a).localeCompare(sortKey(b), undefined, { sensitivity: 'base' })),
    [students]
  );

  const needle = String(value || '').trim().toLowerCase();
  const predictions = useMemo(() => {
    if (!needle) return sorted;
    return sorted.filter((student) => haystack(student).includes(needle));
  }, [needle, sorted]);

  useEffect(() => { setHighlight(0); }, [needle]);

  useEffect(() => {
    const close = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const choose = (student) => {
    onChange(displayName(student));
    onSelect?.(student);
    setOpen(false);
  };

  return (
    <div className="student-typeahead" ref={wrapRef}>
      {label && <label htmlFor={inputId}>{label}</label>}
      <div className="student-typeahead-field">
        <input
          id={inputId}
          value={value}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && predictions[highlight] ? `${listId}-${highlight}` : undefined}
          autoComplete="off"
          placeholder={placeholder}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setHighlight((index) => Math.min(index + 1, Math.max(predictions.length - 1, 0)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlight((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter' && open && predictions[highlight]) {
              event.preventDefault();
              choose(predictions[highlight]);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {open && (
          <ul id={listId} role="listbox" className="student-typeahead-menu">
            {predictions.length === 0 ? (
              <li className="student-typeahead-empty">No matching students</li>
            ) : predictions.map((student, index) => (
              <li
                key={student.id || `${student.email || alphabetLabel(student)}-${index}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === highlight}
                className={index === highlight ? 'is-active' : undefined}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(student);
                }}
                onMouseEnter={() => setHighlight(index)}
              >
                <strong>{alphabetLabel(student)}</strong>
                {(student.company_name || student.email) && (
                  <span>{[student.company_name, student.email].filter(Boolean).join(' · ')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default StudentTypeahead;
