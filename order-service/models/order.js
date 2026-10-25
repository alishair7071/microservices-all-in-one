const mongoose = require('mongoose');

module.exports = mongoose.model('Order', new mongoose.Schema({
  productId: String,
  productName: String,
  quantity: Number,
  customerName: String,
  userEmail: String,
  status: String,
  reservationId: String,
  saga: {
    paymentOutcome: String,
    compensation: String,
    message: String,
    updatedAt: Date
  },
  createdAt: Date
}));
