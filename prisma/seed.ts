import { PrismaClient, UserRole, UserStatus, TenantUserRole, TenantUserStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('qwerty20', 10);

  // Tenant oluştur
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Example Corp',
      domain: 'example.com',
      region: 'TR',
    },
  });

  // Kullanıcılar
  const users = await prisma.user.createMany({
    data: [
      {
        email: 'alice@example.com',
        phone: '+905551112233',
        password: hashedPassword,
        name: 'Alice',
        lastName: 'Wonderland',
        userRole: UserRole.USER,
        userStatus: UserStatus.ACTIVE,
        profilePicture: 'https://example.com/alice.jpg',
        userNationalityCountry: 'TR',
      },
      {
        email: 'bob@example.com',
        phone: '+905556667788',
        password: hashedPassword,
        name: 'Bob',
        lastName: 'Builder',
        userRole: UserRole.ADMIN,
        userStatus: UserStatus.ACTIVE,
        profilePicture: 'https://example.com/bob.jpg',
        userNationalityCountry: 'DE',
      },
      {
        email: 'charlie@example.com',
        password: hashedPassword,
        name: 'Charlie',
        lastName: 'Chaplin',
        userRole: UserRole.USER,
        userStatus: UserStatus.ACTIVE,
        userNationalityCountry: 'UK',
      }
    ],
  });

  // Kullanıcıları al
  const [alice, bob, charlie] = await prisma.user.findMany({
    where: {
      email: {
        in: ['alice@example.com', 'bob@example.com', 'charlie@example.com']
      }
    }
  });

  // TenantUser ilişkileri
  await prisma.tenantUser.createMany({
    data: [
      {
        userId: alice.userId,
        tenantId: tenant.tenantId,
        tenantUserRole: TenantUserRole.USER,
        tenantUserStatus: TenantUserStatus.ACTIVE,
      }
    ]
  });

}

main()
  .catch((e) => {
    console.error('Seed hatası:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
