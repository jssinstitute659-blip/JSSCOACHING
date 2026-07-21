const request = require('supertest');
const crypto = require('crypto');
const app = require('../helpers/testApp');
const PaidBatch = require('../../src/models/PaidBatch');
const PaidBatchOrder = require('../../src/models/PaidBatchOrder');
const PaidUser = require('../../src/models/PaidUser');

// Mock the razorpay package entirely — no real network calls, no real API key needed in tests
jest.mock('razorpay');
jest.mock('../../src/config/mailer', () => ({
  sendPasswordEmail: jest.fn().mockResolvedValue(true),
}));
const Razorpay = require('razorpay');

describe('Paid batch purchase flow', () => {
  let batch;

  beforeEach(async () => {
    batch = await PaidBatch.create({
      title: 'Test Crash Course',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      thumbnailKey: 'thumb-key',
      price: 4999,
      isPublished: true,
    });

    // Fake what razorpay.orders.create() would normally return from Razorpay's real API
    Razorpay.mockImplementation(() => ({
      orders: {
        create: jest.fn().mockResolvedValue({
          id: 'order_test123',
          amount: 499900,
        }),
      },
    }));
  });

  it('creates a Razorpay order and a PaidBatchOrder record for a published batch', async () => {
    const res = await request(app)
      .post('/api/paid-batches/purchase/create-order')
      .send({ batchId: batch._id.toString(), fullName: 'Test Buyer', email: 'buyer@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.data.orderId).toBe('order_test123');

    const orderRecord = await PaidBatchOrder.findOne({ razorpayOrderId: 'order_test123' });
    expect(orderRecord).not.toBeNull();
    expect(orderRecord.status).toBe('created');
    expect(orderRecord.email).toBe('buyer@test.com');
  });

  it('rejects order creation for a batch that is not published', async () => {
    const draftBatch = await PaidBatch.create({
      title: 'Draft Batch',
      thumbnailUrl: 'x', thumbnailKey: 'x',
      price: 999,
      isPublished: false,
    });

    const res = await request(app)
      .post('/api/paid-batches/purchase/create-order')
      .send({ batchId: draftBatch._id.toString(), fullName: 'Buyer', email: 'buyer@test.com' });

    expect(res.status).toBe(404);
  });

  it('verifies a correctly-signed payment and creates a new PaidUser', async () => {
    await PaidBatchOrder.create({
      batchId: batch._id,
      fullName: 'New Buyer',
      email: 'newbuyer@test.com',
      amount: 4999,
      razorpayOrderId: 'order_valid',
      status: 'created',
    });

    // Build a REAL, correctly-computed signature the same way Razorpay actually does,
    // so we're testing the real verification logic, not faking a shortcut.
    const razorpay_order_id = 'order_valid';
    const razorpay_payment_id = 'pay_valid123';
    const validSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'test_secret')
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const res = await request(app)
      .post('/api/paid-batches/purchase/verify')
      .send({ razorpay_order_id, razorpay_payment_id, razorpay_signature: validSignature });

    expect(res.status).toBe(200);
    expect(res.body.data.isNewUser).toBe(true);

    const newUser = await PaidUser.findOne({ email: 'newbuyer@test.com' });
    expect(newUser).not.toBeNull();
    expect(newUser.purchasedBatches.map(String)).toContain(batch._id.toString());
  });

  it('rejects a payment with a tampered/incorrect signature', async () => {
    await PaidBatchOrder.create({
      batchId: batch._id,
      fullName: 'Attacker',
      email: 'attacker@test.com',
      amount: 4999,
      razorpayOrderId: 'order_tampered',
      status: 'created',
    });

    const res = await request(app)
      .post('/api/paid-batches/purchase/verify')
      .send({
        razorpay_order_id: 'order_tampered',
        razorpay_payment_id: 'pay_fake',
        razorpay_signature: 'this_is_not_a_valid_signature',
      });

    expect(res.status).toBe(400);

    const order = await PaidBatchOrder.findOne({ razorpayOrderId: 'order_tampered' });
    expect(order.status).toBe('failed'); // confirms it was marked failed, not silently ignored

    const noUser = await PaidUser.findOne({ email: 'attacker@test.com' });
    expect(noUser).toBeNull(); // no account should have been created from a failed verification
  });

  it('is idempotent — verifying the same already-paid order twice does not create a duplicate PaidUser or double-credit', async () => {
    const order = await PaidBatchOrder.create({
      batchId: batch._id,
      fullName: 'Repeat Verifier',
      email: 'repeat@test.com',
      amount: 4999,
      razorpayOrderId: 'order_repeat',
      status: 'paid', // already marked paid, simulating a webhook/retry firing twice
    });

    const res = await request(app)
      .post('/api/paid-batches/purchase/verify')
      .send({
        razorpay_order_id: 'order_repeat',
        razorpay_payment_id: 'pay_repeat',
        razorpay_signature: 'irrelevant_since_already_paid',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.alreadyProcessed).toBe(true);

    const usersWithThisEmail = await PaidUser.find({ email: 'repeat@test.com' });
    expect(usersWithThisEmail.length).toBeLessThanOrEqual(1); // never duplicated
  });

  it('adds a batch to an existing PaidUser instead of creating a duplicate account on repeat purchase', async () => {
    const existingUser = await PaidUser.create({
      fullName: 'Existing Buyer',
      email: 'existing@test.com',
      password: 'already_hashed_placeholder',
      purchasedBatches: [],
    });

    await PaidBatchOrder.create({
      batchId: batch._id,
      fullName: 'Existing Buyer',
      email: 'existing@test.com',
      amount: 4999,
      razorpayOrderId: 'order_existing',
      status: 'created',
    });

    const razorpay_order_id = 'order_existing';
    const razorpay_payment_id = 'pay_existing';
    const validSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'test_secret')
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const res = await request(app)
      .post('/api/paid-batches/purchase/verify')
      .send({ razorpay_order_id, razorpay_payment_id, razorpay_signature: validSignature });

    expect(res.body.data.isNewUser).toBe(false);

    const updatedUser = await PaidUser.findById(existingUser._id);
    expect(updatedUser.purchasedBatches.map(String)).toContain(batch._id.toString());

    const allUsersWithEmail = await PaidUser.find({ email: 'existing@test.com' });
    expect(allUsersWithEmail.length).toBe(1); // still just one account, not a duplicate
  });
});