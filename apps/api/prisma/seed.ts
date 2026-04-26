import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const maya = await prisma.user.upsert({
    where: { email: 'maya@example.com' },
    update: {},
    create: {
      email: 'maya@example.com',
      name: 'Maya Chen',
      timezone: 'America/New_York',
    },
  });
  console.log(`seeded user ${maya.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
