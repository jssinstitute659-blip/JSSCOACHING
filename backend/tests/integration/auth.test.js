const request = require('supertest');
const app = require('../helpers/testApp');
const bcrypt = require('bcryptjs');
const User = require('../../src/models/User');
const PaidUser = require('../../src/models/PaidUser');
const { createUser } = require('../helpers/factories');

describe('POST /api/auth/login', () => {
  it('logs in an admin with correct credentials and returns role=admin', async () => {
    await createUser({ username: 'admintest', password: 'admin123', role: 'admin' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admintest', password: 'admin123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.role).toBe('admin');
    expect(res.body.token).toBeDefined();
  });

  it('logs in a teacher and a student the same way, returning their own correct role', async () => {
    await createUser({ username: 'teachertest', password: 'teach123', role: 'teacher' });
    await createUser({ username: 'studenttest', password: 'stud123', role: 'student' });

    const teacherRes = await request(app).post('/api/auth/login').send({ username: 'teachertest', password: 'teach123' });
    const studentRes = await request(app).post('/api/auth/login').send({ username: 'studenttest', password: 'stud123' });

    expect(teacherRes.body.role).toBe('teacher');
    expect(studentRes.body.role).toBe('student');
  });

  it('rejects a correct username with a wrong password', async () => {
    await createUser({ username: 'admintest', password: 'admin123', role: 'admin' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admintest', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects a username that does not exist in either User or PaidUser', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody_exists', password: 'whatever' });

    expect(res.status).toBe(401);
  });

  it('falls back to PaidUser when no matching User exists, and returns role=paiduser', async () => {
    const hashedPassword = await bcrypt.hash('buyerpass123', 10);
    await PaidUser.create({
      fullName: 'Test Buyer',
      email: 'buyer@test.com',
      password: hashedPassword,
      mustChangePassword: true,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'buyer@test.com', password: 'buyerpass123' });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('paiduser');
    expect(res.body.mustChangePassword).toBe(true);
  });

  it('never checks PaidUser if a matching User already exists with that username (User takes priority)', async () => {
    // Deliberately create an admin AND a paiduser that could theoretically collide,
    // to prove the User lookup always wins first.
    await createUser({ username: 'shared@test.com', password: 'adminpass', role: 'admin' });
    const hashedPassword = await bcrypt.hash('buyerpass', 10);
    await PaidUser.create({ fullName: 'Shared', email: 'shared@test.com', password: hashedPassword });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'shared@test.com', password: 'adminpass' });

    expect(res.body.role).toBe('admin'); // proves User was checked first, not PaidUser
  });
});