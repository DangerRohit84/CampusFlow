import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Create college first
  const college = await prisma.college.upsert({
    where: { code: 'MIT' },
    update: {},
    create: {
      name: 'MIT College of Engineering',
      code: 'MIT',
      address: '123 College Road, Bangalore',
      phone: '+91-80-12345678',
      website: 'https://mit.edu',
      adminEmail: 'admin@university.edu',
      status: 'APPROVED',
    },
  })
  console.log('Created college:', college.name)

  // Create departments
  const csDept = await prisma.department.upsert({
    where: { collegeId_name: { collegeId: college.id, name: 'Computer Science' } },
    update: {},
    create: { name: 'Computer Science', collegeId: college.id },
  })
  const eeDept = await prisma.department.upsert({
    where: { collegeId_name: { collegeId: college.id, name: 'Electrical Engineering' } },
    update: {},
    create: { name: 'Electrical Engineering', collegeId: college.id },
  })
  const meDept = await prisma.department.upsert({
    where: { collegeId_name: { collegeId: college.id, name: 'Mechanical Engineering' } },
    update: {},
    create: { name: 'Mechanical Engineering', collegeId: college.id },
  })
  console.log('Created departments:', csDept.name, eeDept.name, meDept.name)

  // Create demo student
  const passwordHash = await bcrypt.hash('password123', 10)
  const user = await prisma.user.upsert({
    where: { email: 'alex@university.edu' },
    update: {},
    create: {
      email: 'alex@university.edu',
      name: 'Alex Johnson',
      passwordHash,
      role: 'STUDENT',
      departmentId: csDept.id,
      incomingYear: 2023,
      outgoingYear: 2027,
      studentId: 'CS2023001',
      collegeId: college.id,
    },
  })
  console.log('Created student:', user.name)

  // Create demo teacher
  const teacher = await prisma.user.upsert({
    where: { email: 'prof.sharma@university.edu' },
    update: {},
    create: {
      email: 'prof.sharma@university.edu',
      name: 'Prof. Sharma',
      passwordHash,
      role: 'TEACHER',
      departmentId: csDept.id,
      empNumber: 'EMP001',
      collegeId: college.id,
    },
  })
  console.log('Created teacher:', teacher.name)

  // Create college admin
  const collegeAdmin = await prisma.user.upsert({
    where: { email: 'admin@university.edu' },
    update: {},
    create: {
      email: 'admin@university.edu',
      name: 'College Admin',
      passwordHash,
      role: 'COLLEGE_ADMIN',
      empNumber: 'EMP002',
      collegeId: college.id,
    },
  })
  console.log('Created college admin:', collegeAdmin.name)

  // Create super admin
  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@university.edu' },
    update: {},
    create: {
      email: 'superadmin@university.edu',
      name: 'Super Admin',
      passwordHash,
      role: 'SUPER_ADMIN',
      empNumber: 'EMP003',
    },
  })
  console.log('Created super admin:', superAdmin.name)

  // Create more students for hackathon registrations
  const moreStudents = [
    { email: 'priya@university.edu', name: 'Priya Singh', departmentId: csDept.id, incomingYear: 2023, outgoingYear: 2027, studentId: 'CS2023002', collegeId: college.id },
    { email: 'rahul@university.edu', name: 'Rahul Verma', departmentId: csDept.id, incomingYear: 2023, outgoingYear: 2027, studentId: 'CS2023003', collegeId: college.id },
    { email: 'anjali@university.edu', name: 'Anjali Patel', departmentId: csDept.id, incomingYear: 2024, outgoingYear: 2028, studentId: 'CS2024001', collegeId: college.id },
    { email: 'vikram@university.edu', name: 'Vikram Kumar', departmentId: csDept.id, incomingYear: 2022, outgoingYear: 2026, studentId: 'CS2022001', collegeId: college.id },
  ]

  const createdStudents = [user]
  for (const s of moreStudents) {
    const student = await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: {
        ...s,
        passwordHash,
      },
    })
    createdStudents.push(student)
  }
  console.log('Created', createdStudents.length, 'students total')

  // Create courses
  const courses = [
    { name: 'Data Structures', code: 'CS201', credits: 4, teacherId: teacher.id, semester: 'Fall 2026' },
    { name: 'Algorithms', code: 'CS301', credits: 4, teacherId: teacher.id, semester: 'Fall 2026' },
    { name: 'Database Systems', code: 'CS401', credits: 3, teacherId: teacher.id, semester: 'Fall 2026' },
  ]

  const createdCourses = []
  for (const c of courses) {
    const course = await prisma.course.upsert({
      where: { code: c.code },
      update: {},
      create: c,
    })
    createdCourses.push(course)
  }
  console.log('Created', createdCourses.length, 'courses')

  // Enroll student in all courses
  const enrollments = []
  for (const course of createdCourses) {
    const enrollment = await prisma.enrollment.upsert({
      where: { studentId_courseId: { studentId: user.id, courseId: course.id } },
      update: {},
      create: { studentId: user.id, courseId: course.id },
    })
    enrollments.push(enrollment)
  }
  console.log('Created', enrollments.length, 'enrollments')

  // Create schedules
  const schedules = [
    { title: 'Data Structures', course: 'CS201', location: 'Room 301', teacher: 'Prof. Sharma', dayOfWeek: 1, startTime: '09:00', endTime: '10:30', type: 'CLASS', color: '#5c7cfa' },
    { title: 'Machine Learning', course: 'CS301', location: 'Hall A', teacher: 'Dr. Gupta', dayOfWeek: 1, startTime: '11:00', endTime: '12:30', type: 'CLASS', color: '#845ef7' },
    { title: 'DB Lab', course: 'CS202', location: 'Lab 204', teacher: 'Dr. Patel', dayOfWeek: 1, startTime: '14:00', endTime: '16:00', type: 'LAB', color: '#20c997' },
    { title: 'Data Structures', course: 'CS201', location: 'Room 301', teacher: 'Prof. Sharma', dayOfWeek: 2, startTime: '09:00', endTime: '10:30', type: 'CLASS', color: '#5c7cfa' },
    { title: 'ML Lab', course: 'CS301', location: 'Lab 204', teacher: 'Dr. Gupta', dayOfWeek: 2, startTime: '11:00', endTime: '13:00', type: 'LAB', color: '#845ef7' },
    { title: 'Database Systems', course: 'CS202', location: 'Hall B', teacher: 'Dr. Patel', dayOfWeek: 2, startTime: '14:00', endTime: '15:30', type: 'CLASS', color: '#20c997' },
    { title: 'Placement Prep', course: 'PL001', location: 'Seminar Hall', dayOfWeek: 2, startTime: '16:00', endTime: '17:00', type: 'SEMINAR', color: '#fcc419' },
    { title: 'Machine Learning', course: 'CS301', location: 'Hall A', teacher: 'Dr. Gupta', dayOfWeek: 3, startTime: '09:00', endTime: '10:30', type: 'CLASS', color: '#845ef7' },
    { title: 'Operating Systems', course: 'CS302', location: 'Room 205', teacher: 'Prof. Mehta', dayOfWeek: 3, startTime: '11:00', endTime: '12:30', type: 'CLASS', color: '#f06595' },
    { title: 'Data Structures', course: 'CS201', location: 'Room 301', teacher: 'Prof. Sharma', dayOfWeek: 4, startTime: '09:00', endTime: '10:30', type: 'CLASS', color: '#5c7cfa' },
    { title: 'Database Systems', course: 'CS202', location: 'Hall B', teacher: 'Dr. Patel', dayOfWeek: 4, startTime: '11:00', endTime: '12:30', type: 'CLASS', color: '#20c997' },
    { title: 'ML Lab', course: 'CS301', location: 'Lab 204', teacher: 'Dr. Gupta', dayOfWeek: 4, startTime: '14:00', endTime: '16:00', type: 'LAB', color: '#845ef7' },
    { title: 'Operating Systems', course: 'CS302', location: 'Room 205', teacher: 'Prof. Mehta', dayOfWeek: 5, startTime: '09:00', endTime: '10:30', type: 'CLASS', color: '#f06595' },
    { title: 'Machine Learning', course: 'CS301', location: 'Hall A', teacher: 'Dr. Gupta', dayOfWeek: 5, startTime: '11:00', endTime: '12:30', type: 'CLASS', color: '#845ef7' },
    { title: 'Club Meeting', course: 'CLUB', location: 'Activity Room', dayOfWeek: 5, startTime: '15:00', endTime: '16:30', type: 'OTHER', color: '#7950f2' },
  ]

  for (const s of schedules) {
    await prisma.schedule.create({ data: { ...s, userId: user.id } })
  }
  console.log('Created', schedules.length, 'schedules')

  // Create assignments
  const assignments = [
    { courseId: 'CS301', title: 'ML Project Report', description: 'Implement and compare 3 ML models on the given dataset', dueDate: new Date('2026-07-22'), priority: 'HIGH', progress: 75 },
    { courseId: 'CS202', title: 'SQL Query Practice', description: 'Complete 20 SQL queries covering JOINs, subqueries, and aggregation', dueDate: new Date('2026-07-24'), priority: 'MEDIUM', progress: 40 },
    { courseId: 'CS201', title: 'Binary Tree Implementation', description: 'Implement BST with insert, delete, search, and traversal operations', dueDate: new Date('2026-07-26'), priority: 'LOW', progress: 10 },
    { courseId: 'CS302', title: 'Process Scheduling Report', description: 'Compare FCFS, SJF, and Round Robin scheduling algorithms', dueDate: new Date('2026-07-28'), priority: 'LOW', progress: 0 },
    { courseId: 'CS202', title: 'ER Diagram Design', description: 'Design an ER diagram for the hospital management system', dueDate: new Date('2026-07-20'), priority: 'HIGH', status: 'SUBMITTED', progress: 100 },
    { courseId: 'CS201', title: 'Sorting Algorithms Analysis', description: 'Analyze time complexity of sorting algorithms with empirical testing', dueDate: new Date('2026-07-18'), priority: 'LOW', status: 'GRADED', grade: 'A', progress: 100 },
  ]

  for (const a of assignments) {
    await prisma.assignment.create({ data: { ...a, userId: user.id } })
  }
  console.log('Created', assignments.length, 'assignments')

  // Create notifications
  const notifications = [
    { title: 'Mid-term Exam Schedule Released', message: 'The mid-term examination schedule for Spring 2026 has been published.', type: 'EXAM', priority: 'HIGH' },
    { title: 'New Assignment: ML Project Report', message: 'A new assignment has been posted for Machine Learning. Due: July 22.', type: 'ASSIGNMENT', priority: 'URGENT' },
    { title: 'Campus Fest Registration Open', message: 'Annual tech fest "InnovateX 2026" registration is now open.', type: 'EVENT', priority: 'MEDIUM' },
    { title: 'Attendance Warning', message: 'Your attendance in Operating Systems has dropped to 75%.', type: 'ATTENDANCE', priority: 'HIGH' },
    { title: 'Grade Published: Database Systems', message: 'Your grade for Database Systems Assignment 2 has been published.', type: 'GENERAL', priority: 'LOW' },
  ]

  for (const n of notifications) {
    await prisma.notification.create({ data: { ...n, userId: user.id } })
  }
  console.log('Created', notifications.length, 'notifications')

  // Create test hackathons
  const hackathons = [
    {
      creatorId: teacher.id,
      collegeId: college.id,
      title: 'Smart India Hackathon 2026',
      description: 'India\'s largest hackathon organized by AICTE. Build innovative solutions for real-world problems.',
      url: 'https://sih.gov.in',
      organizer: 'AICTE',
      registrationUrl: 'https://sih.gov.in/register',
      startDate: new Date('2026-08-15'),
      endDate: new Date('2026-08-16'),
      deadline: new Date('2026-08-10'),
      teamSize: 6,
      themes: JSON.stringify(['AI/ML', 'HealthTech', 'AgriTech', 'Smart Education']),
      status: 'PUBLISHED',
    },
    {
      creatorId: teacher.id,
      collegeId: college.id,
      title: 'CodeSprint - Campus Edition',
      description: 'A 24-hour coding competition for college students. Solve algorithmic challenges and build prototypes.',
      organizer: 'College Tech Club',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-09-02'),
      deadline: new Date('2026-08-28'),
      teamSize: 4,
      themes: JSON.stringify(['Algorithms', 'Web Development', 'Mobile Apps']),
      status: 'PUBLISHED',
    },
  ]

  const createdHackathons = []
  for (const h of hackathons) {
    const hackathon = await prisma.hackathon.create({ data: h })
    createdHackathons.push(hackathon)
  }
  console.log('Created', createdHackathons.length, 'hackathons')

  // Create test registrations
  const registrations = [
    {
      hackathonId: createdHackathons[0].id,
      userId: user.id,
      teamName: 'Code Warriors',
      teamMembers: 'Alex Johnson, Priya Singh, Rahul Verma',
      projectIdea: 'AI-powered crop disease detection system',
      status: 'REGISTERED',
      currentRound: 0,
    },
    {
      hackathonId: createdHackathons[0].id,
      userId: createdStudents[3].id,
      teamName: 'Tech Innovators',
      teamMembers: 'Anjali Patel, Vikram Kumar',
      projectIdea: 'Smart traffic management system using IoT',
      status: 'REGISTERED',
      currentRound: 0,
    },
  ]

  for (const r of registrations) {
    await prisma.hackathonRegistration.create({ data: r })
  }
  console.log('Created', registrations.length, 'registrations')

  // Create test rounds for first hackathon
  const rounds = [
    { hackathonId: createdHackathons[0].id, roundNumber: 1, title: 'Online Qualifier', description: 'Online coding test', date: new Date('2026-08-20') },
    { hackathonId: createdHackathons[0].id, roundNumber: 2, title: 'Prototype Review', description: 'Submit and present prototype', date: new Date('2026-08-25') },
    { hackathonId: createdHackathons[0].id, roundNumber: 3, title: 'Final Presentation', description: 'Present to judges', date: new Date('2026-09-01') },
  ]

  for (const r of rounds) {
    await prisma.hackathonRound.create({ data: r })
  }
  console.log('Created', rounds.length, 'rounds')

  // Create demo forms
  const forms = [
    {
      creatorId: teacher.id,
      collegeId: college.id,
      title: 'Course Feedback Survey',
      description: 'Help us improve the Data Structures course. Your feedback is valuable!',
      status: 'ACTIVE',
      allowEdit: true,
      expiresAt: new Date('2026-09-30'),
      targetDepartments: JSON.stringify([]),
      targetYears: JSON.stringify([]),
      eligibilityEnabled: false,
      fields: {
        create: [
          { label: 'How would you rate the course overall?', type: 'RATING', required: true, options: '[]', order: 0 },
          { label: 'What did you like most about the course?', type: 'TEXT', required: false, options: '[]', order: 1 },
          { label: 'Any suggestions for improvement?', type: 'TEXTAREA', required: false, options: '[]', order: 2 },
          { label: 'Would you recommend this course?', type: 'SELECT', required: true, options: JSON.stringify(['Yes', 'No', 'Maybe']), order: 3 },
        ],
      },
    },
    {
      creatorId: teacher.id,
      collegeId: college.id,
      title: 'Hackathon Team Registration',
      description: 'Register your team for the upcoming campus hackathon. All fields are required.',
      status: 'ACTIVE',
      allowEdit: false,
      expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      targetDepartments: JSON.stringify([]),
      targetYears: JSON.stringify([]),
      eligibilityEnabled: false,
      fields: {
        create: [
          { label: 'Team Name', type: 'TEXT', required: true, options: '[]', order: 0 },
          { label: 'Team Members (names & roll numbers)', type: 'TEXTAREA', required: true, options: '[]', order: 1 },
          { label: 'Project Idea', type: 'TEXTAREA', required: true, options: '[]', order: 2 },
          { label: 'Preferred Tech Stack', type: 'SELECT', required: true, options: JSON.stringify(['React/Node', 'Python/Django', 'Flutter/Dart', 'MERN Stack', 'Other']), order: 3 },
          { label: 'Have you participated in a hackathon before?', type: 'SELECT', required: true, options: JSON.stringify(['Yes', 'No']), order: 4 },
        ],
      },
    },
  ]

  for (const f of forms) {
    await prisma.form.create({ data: f })
  }
  console.log('Created', forms.length, 'forms')

  console.log('Seed completed!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })