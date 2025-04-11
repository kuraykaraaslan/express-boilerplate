import { PrismaClient, UserRole, UserStatus, TenantStatus, TenantUserRole, TenantUserStatus, AddressType, AddressIntent, Currency, PaymentMethod, OrderStatus, OrderType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Create User
  const user = await prisma.user.create({
    data: {
      email: 'test@example.com',
      password: 'hashed_password', // Not plaintext!
      name: 'Kuray',
      lastName: 'Karaaslan',
      userRole: UserRole.ADMIN,
      userStatus: UserStatus.ACTIVE,
    },
  });

  // 2. Create Tenant
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Demo Corp',
      description: 'Example tenant for testing',
      domain: 'demo.example.com',
      tenantStatus: TenantStatus.ACTIVE,
    },
  });

  // 3. Add user to tenant
  await prisma.tenantUser.create({
    data: {
      userId: user.userId,
      tenantId: tenant.tenantId,
      tenantUserRole: TenantUserRole.ADMIN,
      tenantUserStatus: TenantUserStatus.ACTIVE,
    },
  });

  // 4. Create Address
  const billingAddress = await prisma.address.create({
    data: {
      addressType: AddressType.BUSINESS,
      addressIntents: [AddressIntent.BILLING],
      name: 'Demo Billing',
      addressLine1: '123 Demo St.',
      city: 'Istanbul',
      country: 'TR',
      email: 'billing@demo.com',
      phoneNumber: '+905551112233',
      firstName: 'Demo Company',
    },
  });

  // 5. Create Order
  await prisma.order.create({
    data: {
      userId: user.userId,
      orderType: OrderType.PURCHASE,
      price: 100,
      paidPrice: 118, // example: including tax
      taxRate: 18,
      taxAmount: 18,
      currency: Currency.TRY,
      paymentMethod: PaymentMethod.STRIPE,
      orderStatus: OrderStatus.COMPLETED,
      billingAddressId: billingAddress.addressId,
      createdAt: new Date(),
    },
  });
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
