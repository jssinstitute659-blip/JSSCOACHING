const request = require('supertest');
const app = require('../helpers/testApp');
const { createUser, tokenFor } = require('../helpers/factories');

describe('protect + authorize middleware', () => {
  it('rejects a request with no Authorization header at all', async () => {
    const res = await request(app).get('/api/students');
    expect(res.status).toBe(401);
  });

  it('rejects a request with a garbage/invalid token', async () => {
    const res = await request(app)
      .get('/api/students')
      .set('Authorization', 'Bearer this.is.not.a.real.token');
    expect(res.status).toBe(401);
  });

  it('allows an admin to access an admin-only route', async () => {
    const admin = await createUser({ username: 'admin1', role: 'admin' });
    const res = await request(app)
      .get('/api/students')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
  });

  it('blocks a student from an admin-only route with 403, not 401', async () => {
    const student = await createUser({ username: 'student1', role: 'student' });
    const res = await request(app)
      .post('/api/students')
      .set('Authorization', `Bearer ${tokenFor(student)}`)
      .send({ fullName: 'Should Not Work' });

    expect(res.status).toBe(403); // logged in fine, just not allowed — distinct from 401
  });
});