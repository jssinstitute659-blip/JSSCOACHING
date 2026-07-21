const request = require('supertest');
const app = require('../helpers/testApp');
const { createUser, tokenFor } = require('../helpers/factories');
const Batch = require('../../src/models/Batch');
const Student = require('../../src/models/Student');
const Fee = require('../../src/models/Fee');

describe('Student creation and joining-date logic', () => {
  let admin, adminToken, batch;

  beforeEach(async () => {
    admin = await createUser({ username: 'admin1', role: 'admin' });
    adminToken = tokenFor(admin);
    batch = await Batch.create({ name: 'JEE Batch A', course: 'JEE', isActive: true });
  });

  it('creates a student with an admin-provided joining date, not the server default', async () => {
    const res = await request(app)
      .post('/api/students')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Ram Kumar',
        username: 'ramk',
        password: 'pass123',
        parentPhone: '9999999999',
        batchId: batch._id.toString(),
        monthlyFee: 3000,
        initialFeeStatus: 'unpaid',
        joiningDate: '2026-06-16',
      });

    expect(res.status).toBe(201);
    const savedDate = new Date(res.body.data.joiningDate).toISOString().slice(0, 10);
    expect(savedDate).toBe('2026-06-16');
  });

  it('creates the first Fee cycle anchored to the admin-chosen joining date, one month later', async () => {
    const res = await request(app)
      .post('/api/students')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Shyam Lal',
        username: 'shyaml',
        password: 'pass123',
        parentPhone: '8888888888',
        batchId: batch._id.toString(),
        monthlyFee: 3000,
        initialFeeStatus: 'unpaid',
        joiningDate: '2026-06-16',
      });

    const fee = await Fee.findOne({ studentId: res.body.data._id });
    expect(fee).not.toBeNull();
    expect(new Date(fee.startDate).toISOString().slice(0, 10)).toBe('2026-06-16');
    expect(new Date(fee.endDate).toISOString().slice(0, 10)).toBe('2026-07-16');
  });

  it('blocks a non-admin (teacher) from creating a student', async () => {
    const teacher = await createUser({ username: 'teacher1', role: 'teacher' });
    const res = await request(app)
      .post('/api/students')
      .set('Authorization', `Bearer ${tokenFor(teacher)}`)
      .send({ fullName: 'Should Fail', username: 'x', password: 'x', parentPhone: '1', batchId: batch._id.toString() });

    expect(res.status).toBe(403);
  });

  it('rejects student creation with missing required fields', async () => {
    const res = await request(app)
      .post('/api/students')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fullName: 'Incomplete Student' }); // missing username, password, parentPhone, batchId

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects creation with a username that already exists', async () => {
    await createUser({ username: 'duplicate', role: 'student' });

    const res = await request(app)
      .post('/api/students')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Duplicate Attempt',
        username: 'duplicate',
        password: 'pass123',
        parentPhone: '7777777777',
        batchId: batch._id.toString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already taken/i);
  });
});

describe('PATCH /api/students/:id/joining-date', () => {
  let admin, adminToken, batch, student;

  beforeEach(async () => {
    admin = await createUser({ username: 'admin1', role: 'admin' });
    adminToken = tokenFor(admin);
    batch = await Batch.create({ name: 'JEE Batch A', course: 'JEE', isActive: true });

    const createRes = await request(app)
      .post('/api/students')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Test Student',
        username: 'teststudent',
        password: 'pass123',
        parentPhone: '9999999999',
        batchId: batch._id.toString(),
        monthlyFee: 3000,
        initialFeeStatus: 'unpaid',
        joiningDate: '2026-06-16',
      });
    student = createRes.body.data;
  });

  it('allows editing the joining date when the student has exactly 1 fee cycle', async () => {
    const res = await request(app)
      .patch(`/api/students/${student._id}/joining-date`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ joiningDate: '2026-05-01' });

    expect(res.status).toBe(200);

    const updatedFee = await Fee.findOne({ studentId: student._id });
    expect(new Date(updatedFee.startDate).toISOString().slice(0, 10)).toBe('2026-05-01');
    expect(new Date(updatedFee.endDate).toISOString().slice(0, 10)).toBe('2026-06-01');
  });

  it('blocks editing the joining date once more than 1 fee cycle exists', async () => {
    // Simulate fee auto-generation having already progressed the billing chain
    await Fee.create({
      studentId: student._id,
      batchId: batch._id,
      amount: 3000,
      paidAmount: 0,
      startDate: new Date('2026-07-16'),
      endDate: new Date('2026-08-16'),
      status: 'pending',
    });

    const res = await request(app)
      .patch(`/api/students/${student._id}/joining-date`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ joiningDate: '2026-01-01' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already has multiple fee cycles/i);

    // Confirm the original student record was NOT changed
    const unchangedStudent = await Student.findById(student._id);
    expect(new Date(unchangedStudent.joiningDate).toISOString().slice(0, 10)).toBe('2026-06-16');
  });
});