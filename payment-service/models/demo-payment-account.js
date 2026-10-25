const mongoose = require('mongoose');

const effectSchema = new mongoose.Schema({
  transactionId: { type: String, required: true },
  logicalPaymentId: { type: String, required: true },
  idempotencyKey: String,
  amountCents: { type: Number, required: true },
  currency: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const accountSchema = new mongoose.Schema({
  runId: { type: String, required: true, unique: true },
  logicalPaymentId: { type: String, required: true },
  mode: { type: String, required: true, enum: ['protected', 'unprotected'] },
  idempotencyKey: { type: String, required: true },
  balanceCents: { type: Number, required: true, default: 0 },
  effects: { type: [effectSchema], default: [] },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('DemoPaymentAccount', accountSchema);
