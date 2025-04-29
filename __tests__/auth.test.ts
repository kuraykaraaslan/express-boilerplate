import request from 'supertest';
import app from '../index';
import prismaClient from '../libs/prisma';
import AuthErrors from '../errors/AuthErrors';



describe('Auth API', () => {
  beforeAll(async () => {
    await prismaClient.$connect();
    console.log('Connected to database');
  });

  afterAll(async () => {
    await prismaClient.$disconnect();
  });

  it('should fail login with wrong credentials', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'kuray@example.com',
      password: 'qwerty20',
    });

    console.log(res.body);
    expect(res.status).toBe(500); // TODO: Change to 401
    expect(res.body.error).toMatch(AuthErrors.INVALID_EMAIL_OR_PASSWORD);
  });
});
