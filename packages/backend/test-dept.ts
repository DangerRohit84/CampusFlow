import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  try {
    // Test creating a department
    const dept = await prisma.department.create({
      data: {
        name: 'Information Technology',
        collegeId: '1f033235-c580-4ee7-919c-2eab325fccc3',
      },
    })
    console.log('Created department:', dept)
  } catch (error) {
    console.error('Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

main()