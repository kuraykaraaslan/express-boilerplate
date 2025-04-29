import request from 'supertest';
import app from '../index'; // Express uygulamasını export etmiş olman gerekiyor
import AuthErrors from '../errors/AuthErrors';
import prismaClient from '../libs/prisma'; // ya da kendi prisma client yolun



describe('Auth API', () => {

  beforeAll(async () => {
    // Veritabanını temizle
    await prismaClient.$connect();
    console.log('Connected to database');
  });


  it('should fail login with wrong credentials', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'kuray@example.com',
      password: 'qwerty20',
    });

    console.log(res.body);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(AuthErrors.INVALID_EMAIL_OR_PASSWORD.toString());
  });
});
