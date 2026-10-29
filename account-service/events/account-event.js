const mongoose = require('mongoose');

const accountEventSchema = new mongoose.Schema({
  accountId: { type: String, required: true, immutable: true },
  sequence: { type: Number, required: true, immutable: true },
  commandId: { type: String, sparse: true, immutable: true },
  type: { type: String, enum: ['AccountOpened', 'MoneyDeposited', 'MoneyWithdrawn'], required: true, immutable: true },
  amountCents: { type: Number, required: true, immutable: true },
  currency: { type: String, default: 'USD', immutable: true },
  occurredAt: { type: Date, default: Date.now, immutable: true }
}, {
  versionKey: false,
  collection: 'account_events'
});

accountEventSchema.index({ accountId: 1, sequence: 1 }, { unique: true });
accountEventSchema.index({ accountId: 1, commandId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('AccountEvent', accountEventSchema);
