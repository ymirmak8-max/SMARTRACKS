import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../config/db.js';
import { archiveRequirement, createRequirement, getStudentDocuments, updateRequirement } from '../controllers/documentController.js';

const recorder = () => {
  const result = { statusCode: 200, body: null };
  return {
    result,
    response: {
      status(code) { result.statusCode = code; return this; },
      json(body) { result.body = body; return this; },
    },
  };
};

test('student document listing includes active requirements and archived requirements with history', async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (query, params) => {
    calls.push({ query, params });
    if (query.includes('FROM document_requirements requirement')) return { rows: [{ id: 'requirement-1', is_active: true }] };
    if (query.includes('FROM student_documents sd')) return { rows: [] };
    return { rows: [] };
  };
  try {
    const { response, result } = recorder();
    await getStudentDocuments({ params: {}, user: { id: 'student-1', role: 'student' } }, response);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.documents.length, 1);
    const requirementsCall = calls.find(call => call.query.includes('FROM document_requirements requirement'));
    assert.match(requirementsCall.query, /is_active = true/);
    assert.match(requirementsCall.query, /EXISTS/);
    assert.deepEqual(requirementsCall.params, ['student-1']);
  } finally { pool.query = originalQuery; }
});

test('requirement creation validates fields and persists display configuration', async () => {
  const originalQuery = pool.query;
  const insertCalls = [];
  pool.query = async (query, params) => {
    if (query.includes('SELECT 1 FROM document_requirements')) return { rows: [] };
    if (query.includes('INSERT INTO document_requirements')) {
      insertCalls.push(params);
      return { rows: [{ id: 'requirement-1', name: params[0] }] };
    }
    return { rows: [] };
  };
  try {
    const { response, result } = recorder();
    await createRequirement({
      user: { id: 'admin-1' }, body: {
        name: ' Résumé ', description: ' Current résumé ', isRequired: true,
        deadlineDaysBeforeOjt: 15, sortOrder: 10,
      },
    }, response);
    assert.equal(result.statusCode, 201);
    assert.deepEqual(insertCalls[0], ['Résumé', 'Current résumé', true, 15, 10]);
  } finally { pool.query = originalQuery; }
});

test('requirement updates can reactivate archived records and archive retains linked submissions', async () => {
  const originalQuery = pool.query;
  pool.query = async (query, params) => {
    if (query.includes('SELECT 1 FROM document_requirements')) return { rows: [] };
    if (query.includes('UPDATE document_requirements') && query.includes('COALESCE'))
      return { rows: [{ id: params.at(-1), name: params[0], is_active: params[5] }] };
    if (query.includes('UPDATE document_requirements')) return { rows: [{ id: params[0], is_active: false }] };
    if (query.includes('COUNT(*)')) return { rows: [{ count: 3 }] };
    return { rows: [] };
  };
  try {
    const updateResult = recorder();
    await updateRequirement({
      params: { requirementId: 'requirement-1' }, user: { id: 'admin-1' },
      body: { name: 'Résumé', isRequired: true, sortOrder: 10, isActive: true },
    }, updateResult.response);
    assert.equal(updateResult.result.body.requirement.is_active, true);

    const archiveResult = recorder();
    await archiveRequirement({
      params: { requirementId: 'requirement-1' }, user: { id: 'admin-1' },
    }, archiveResult.response);
    assert.equal(archiveResult.result.statusCode, 200);
    assert.match(archiveResult.result.body.message, /3 linked submissions retained/);
  } finally { pool.query = originalQuery; }
});
