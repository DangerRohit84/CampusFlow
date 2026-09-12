// lib/validation.test.ts — locks topbottom F1/F6/F9 validators.
import { describe, it, expect } from 'vitest'
import { isValidEmail, parseSubjects, validateCollegeRegistration } from './validation'

describe('isValidEmail', () => {
  it('accepts normal campus emails', () => {
    expect(isValidEmail('a@college.edu')).toBe(true)
    expect(isValidEmail(' admin@college.edu ')).toBe(true)
  })
  it('rejects junk', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('no-at')).toBe(false)
    expect(isValidEmail('a@b')).toBe(false)
    expect(isValidEmail(null)).toBe(false)
  })
})

describe('parseSubjects', () => {
  it('splits comma lists and drops empties', () => {
    expect(parseSubjects('DS, ML,  DBMS ')).toEqual(['DS', 'ML', 'DBMS'])
    expect(parseSubjects('  ')).toEqual([])
    expect(parseSubjects('')).toEqual([])
    expect(parseSubjects(null)).toEqual([])
  })
})

describe('validateCollegeRegistration', () => {
  const good = {
    collegeName: 'MIT College',
    collegeCode: 'MIT',
    adminName: 'Aarav Singh',
    adminEmail: 'admin@mit.edu',
    adminPassword: 'strongpass1',
  }
  it('passes good form', () => {
    expect(validateCollegeRegistration(good)).toEqual({})
  })
  it('flags required + format', () => {
    const e = validateCollegeRegistration({
      collegeName: 'AB',
      collegeCode: 'x!',
      adminName: '',
      adminEmail: 'bad',
      adminPassword: 'short',
    })
    expect(e.collegeName).toMatch(/at least 3/)
    expect(e.collegeCode).toMatch(/2–12/)
    expect(e.adminName).toBeTruthy()
    expect(e.adminEmail).toMatch(/valid email/)
    expect(e.adminPassword).toMatch(/Minimum 8/)
  })
  it('flags long password (bcrypt 72 cap)', () => {
    const e = validateCollegeRegistration({ ...good, adminPassword: 'x'.repeat(73) })
    expect(e.adminPassword).toMatch(/Maximum 72/)
  })
})
