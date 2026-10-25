const mongoose = require('mongoose');

module.exports = mongoose.model('InventoryReservation', new mongoose.Schema({
  orderId: { type: String, unique: true, index: true },
  productId: String,
  quantity: Number,
  state: { type: String, enum: ['reserved', 'compensating', 'compensated'], default: 'reserved' },
  createdAt: { type: Date, default: Date.now },
  compensatedAt: Date
}));
