const { PrismaClient } = require('./packages/backend/node_modules/@prisma/client');
const p = new PrismaClient();
p.user.findMany({ where: { email: 'admin@university.edu' }, include: { college: true, department: true } })
  .then(function(r) { console.log(JSON.stringify(r, null, 2)); p.$disconnect(); })
  .catch(function(e) { console.error(e); p.$disconnect(); });
