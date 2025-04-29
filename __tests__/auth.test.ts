import request from 'supertest';
import app from '../index'; // Express uygulamasını export etmiş olman gerekiyor
import AuthErrors from '../errors/AuthErrors';

describe('Auth API', () => {
  it('should fail login with wrong credentials', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'kuray@example.com',
      password: 'qwerty20',
    });

    console.log(res.body);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch("ERROR_BAD_REQUEST");
  });
});
