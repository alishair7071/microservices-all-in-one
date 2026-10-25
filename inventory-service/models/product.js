const mongoose = require('mongoose');

module.exports = mongoose.model('Product', new mongoose.Schema({
  name: String,
  stock: Number,
  compensatedReservationIds: { type: [String], default: [] }
}));
