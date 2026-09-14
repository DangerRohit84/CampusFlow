// lib/__tests__/uploadAuditAll.test.ts — every upload path gets the
// timetable treatment (60s budget for AI/multipart work, tolerant reader,
// honest errors). Locks:
//  - attendance/grades vision parse use fetch (60s), not the 15s default.
//  - resume parse/convert use 60s/90s (AI structuring + vision).
//  - rooms chat + resources multipart use 60s (10MB Cloudinary persist).
//  - assignment hub create/update/submit multipart use 60s.
//  - bulk CSV import (≤50 writes + audit) uses 60s.
//  - AI chat text calls use 60s.
//  - tolerant readers never throw; error helpers prefer backendMsg, then the
//    60s timeout hint (timetable precedent).
import { describe, it, expect, vi } from 'vitest';
import { normalizeAttendanceSubjects, normalizeGradeSubjects } from '../api/resources/assignments';
import { attendanceParseErrorMessage } from '../../pages/AttendancePage';
import { gradesParseErrorMessage } from '../../pages/GradesPage';
import { MAX_FILE_SIZE } from '../../components/room/chatUtils';

function subjects42() {
  return Array.from({ length: 3 }, (_, i) => ({
    name: `Sub ${i + 1}`,
    held: 10 + i,
    attended: 9 + i,
  }));
}

describe('tolerant readers (attendance/grades handoff)', () => {
  it('attendance: canonical { subjects } shape passes through', () => {
    const out = normalizeAttendanceSubjects({ subjects: subjects42() });
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ name: 'Sub 1', held: 10, attended: 9 });
  });

  it('attendance: drifted shapes (bare array, data key, subject/total/present)', () => {
    const drifted = [{ subject: 'Chem', total: '42', present: '40' }];
    expect(normalizeAttendanceSubjects(drifted)).toEqual([{ name: 'Chem', held: 42, attended: 40 }]);
    expect(normalizeAttendanceSubjects({ data: drifted })).toEqual([{ name: 'Chem', held: 42, attended: 40 }]);
    expect(normalizeAttendanceSubjects(drifted)).toHaveLength(1);
  });

  it('attendance: never throws — null/string/bare object → []', () => {
    expect(normalizeAttendanceSubjects(null)).toEqual([]);
    expect(normalizeAttendanceSubjects(undefined)).toEqual([]);
    expect(normalizeAttendanceSubjects('oops')).toEqual([]);
    expect(normalizeAttendanceSubjects({})).toEqual([]);
    expect(normalizeAttendanceSubjects({ subjects: 'nope' })).toEqual([]);
  });

  it('grades: canonical + drifted (title/courseCode/score, bare array)', () => {
    const canon = [{ name: 'Math', code: 'MA101', credits: 4, grade: 'A' }];
    expect(normalizeGradeSubjects({ subjects: canon })).toEqual(canon);
    const drifted = [{ title: 'Phy', courseCode: 'PH1', credit: '3', score: 'B+' }];
    expect(normalizeGradeSubjects(drifted)).toEqual([{ name: 'Phy', code: 'PH1', credits: 3, grade: 'B+' }]);
    expect(normalizeGradeSubjects({ courses: drifted })).toEqual([{ name: 'Phy', code: 'PH1', credits: 3, grade: 'B+' }]);
  });

  it('grades: never throws — null/string/bare object → []', () => {
    expect(normalizeGradeSubjects(null)).toEqual([]);
    expect(normalizeGradeSubjects(undefined)).toEqual([]);
    expect(normalizeGradeSubjects('oops')).toEqual([]);
    expect(normalizeGradeSubjects({})).toEqual([]);
  });
});

describe('honest error helpers (backendMsg first, 60s hint on abort)', () => {
  it('attendance prefers backend message', () => {
    expect(attendanceParseErrorMessage({ response: { data: { error: 'Invalid image file' } } })).toBe('Invalid image file');
  });

  it('attendance maps ECONNABORTED to the 60s hint', () => {
    expect(attendanceParseErrorMessage({ code: 'ECONNABORTED', message: 'timeout of 60000ms exceeded' })).toMatch(/60s/);
  });

  it('attendance falls back to generic only for true failures', () => {
    expect(attendanceParseErrorMessage(new Error('Network Error'))).toBe('Failed to parse image');
  });

  it('grades prefers backend message + maps timeout', () => {
    expect(gradesParseErrorMessage({ response: { data: { error: 'Could not parse grades from image' } } })).toBe(
      'Could not parse grades from image',
    );
    expect(gradesParseErrorMessage({ code: 'ECONNABORTED', message: 'timeout exceeded' })).toMatch(/60s/);
    expect(gradesParseErrorMessage(new Error('boom'))).toBe('Failed to parse image');
  });
});

describe('chat client gate mirrors the backend 10MB limit', () => {
  it('MAX_FILE_SIZE is 10MB (backend multer limit), not 50MB', () => {
    expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
  });
});

describe('upload-path timeouts (AI + multipart need 60s, not 15s default)', () => {
  it('attendance/grades vision parse use fetch (60s)', async () => {
    const apiMod = await import('../api/resources/assignments');
    const clientMod = await import('../api/client');
    expect(clientMod.API_TIMEOUTS.fetch).toBe(60000);
    const calls: any[] = [];
    const spy = vi.spyOn(clientMod.api as any, 'post').mockImplementation((...args: any[]) => {
      calls.push(args);
      return Promise.resolve({ data: { subjects: [] } });
    });
    try {
      await apiMod.attendanceAPI.parse('data:image/png;base64,xx').catch(() => {});
      await apiMod.gradesAPI.parse('data:image/png;base64,xx').catch(() => {});
    } finally {
      spy.mockRestore();
    }
    expect(calls).toHaveLength(2);
    for (const [, , cfg] of calls) expect(cfg?.timeout).toBe(clientMod.API_TIMEOUTS.fetch);
  });

  it('resume parse uses 60s; convert-to-latex uses 90s', async () => {
    const apiMod = await import('../api/resources/profile');
    const clientMod = await import('../api/client');
    const calls: any[] = [];
    const spy = vi.spyOn(clientMod.api as any, 'post').mockImplementation((...args: any[]) => {
      calls.push(args);
      return Promise.resolve({ data: {} });
    });
    try {
      const f = new File(['x'], 'r.pdf', { type: 'application/pdf' });
      await apiMod.resumeAPI.parseResume(f).catch(() => {});
      await apiMod.resumeAPI.parseUpload(f).catch(() => {});
      await apiMod.resumeAPI.convertToLatex(f).catch(() => {});
      await apiMod.resumeAPI.convertTextToLatex('some long resume text here').catch(() => {});
    } finally {
      spy.mockRestore();
    }
    expect(calls).toHaveLength(4);
    expect(calls[0][2]?.timeout).toBe(clientMod.API_TIMEOUTS.fetch);
    expect(calls[1][2]?.timeout).toBe(clientMod.API_TIMEOUTS.fetch);
    expect(calls[2][2]?.timeout).toBe(90000);
    expect(calls[3][2]?.timeout).toBe(90000);
  });

  it('rooms chat + resources multipart use 60s', async () => {
    const apiMod = await import('../api/resources/rooms');
    const clientMod = await import('../api/client');
    const calls: any[] = [];
    const spy = vi.spyOn(clientMod.api as any, 'post').mockImplementation((...args: any[]) => {
      calls.push(args);
      return Promise.resolve({ data: {} });
    });
    try {
      const f = new File(['x'], 'n.pdf', { type: 'application/pdf' });
      const fd = new FormData();
      fd.append('file', f);
      await apiMod.roomAPI.sendMessage('room1', { content: 'hi', file: f }).catch(() => {});
      await apiMod.roomAPI.uploadResource('room1', fd).catch(() => {});
      await apiMod.chatAPI.sendMessage('sess1', 'hello').catch(() => {});
      await apiMod.chatAPI.ask('hello').catch(() => {});
      await apiMod.chatAPI.summarize('hello').catch(() => {});
    } finally {
      spy.mockRestore();
    }
    expect(calls).toHaveLength(5);
    for (const [, , cfg] of calls) expect(cfg?.timeout).toBe(clientMod.API_TIMEOUTS.fetch);
  });

  it('assignment hub create/update/submit use 60s for multipart', async () => {
    const apiMod = await import('../api/resources/assignments');
    const clientMod = await import('../api/client');
    const calls: any[] = [];
    const spy = vi.spyOn(clientMod.api as any, 'post').mockImplementation((...args: any[]) => {
      calls.push(args);
      return Promise.resolve({ data: {} });
    });
    const putCalls: any[] = [];
    const putSpy = vi.spyOn(clientMod.api as any, 'put').mockImplementation((...args: any[]) => {
      putCalls.push(args);
      return Promise.resolve({ data: {} });
    });
    try {
      const f = new File(['x'], 'a.pdf', { type: 'application/pdf' });
      const fd = new FormData();
      fd.append('title', 'T');
      fd.append('attachments', f);
      await apiMod.assignmentHubAPI.create(fd).catch(() => {});
      await apiMod.assignmentHubAPI.update('hub1', fd).catch(() => {});
      await apiMod.assignmentHubAPI.submit('hub1', { content: 'done', files: [f] }).catch(() => {});
    } finally {
      spy.mockRestore();
      putSpy.mockRestore();
    }
    expect(calls).toHaveLength(2);
    for (const [, , cfg] of calls) expect(cfg?.timeout).toBe(clientMod.API_TIMEOUTS.fetch);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0][2]?.timeout).toBe(clientMod.API_TIMEOUTS.fetch);
  });

  it('bulk CSV import (writes + audit) uses 60s', async () => {
    const apiMod = await import('../api/resources/admin');
    const clientMod = await import('../api/client');
    const calls: any[] = [];
    const spy = vi.spyOn(clientMod.api as any, 'post').mockImplementation((...args: any[]) => {
      calls.push(args);
      return Promise.resolve({ data: {} });
    });
    try {
      await apiMod.bulkImportAPI.importRows('STUDENT', []).catch(() => {});
      await apiMod.bulkImportAPI.importCsv('TEACHER', 'name,email\nA,a@x.com').catch(() => {});
      await apiMod.bulkImportAPI.dryRunImport('STUDENT', []).catch(() => {});
    } finally {
      spy.mockRestore();
    }
    expect(calls).toHaveLength(3);
    for (const [, , cfg] of calls) expect(cfg?.timeout).toBe(clientMod.API_TIMEOUTS.fetch);
  });
});
