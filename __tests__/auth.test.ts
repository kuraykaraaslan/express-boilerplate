import request from 'supertest';
import app from '../index';
import prismaClient from '../libs/prisma';
import AuthMessages from '../dictionaries/AuthMessages';



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

    expect(res.status).toBe(500); // TODO: Change to 401
    expect(res.body.error).toMatch(AuthMessages.INVALID_EMAIL_OR_PASSWORD);
  });

  it('should fail login with empty credentials', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: '',
      password: '',
    });

    expect(res.status).toBe(500); // TODO: Change to 400
    expect(res.body.error).toMatch(AuthMessages.INVALID_EMAIL_OR_PASSWORD);
  });

  it('should fail login with invalid email', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'kurayexample.com',
      password : 'qwerty20',
    });
    expect(res.status).toBe(500); // TODO: Change to 400
    expect(res.body.error).toMatch(AuthMessages.INVALID_EMAIL_OR_PASSWORD);
  });

  it('should fail login with invalid password', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'kurayexample.com',
      password : 'qwerty201',
    });
    expect(res.status).toBe(500); // TODO: Change to 400
    expect(res.body.error).toMatch(AuthMessages.INVALID_EMAIL_OR_PASSWORD);
  });
});
