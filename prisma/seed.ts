import { PrismaClient} from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  
}

main()
  .then(() => {
    console.log('✅ Seed completed');
  })
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
