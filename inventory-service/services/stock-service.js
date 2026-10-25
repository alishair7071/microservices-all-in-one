const Product = require('../models/product');
const InventoryReservation = require('../models/inventory-reservation');

async function reduceStock(productId, quantity, reservationId) {
  if (!Number.isInteger(quantity) || quantity <= 0 || !reservationId) return { success: false, remaining_stock: 0 };

  const existing = await InventoryReservation.findOne({ orderId: reservationId });
  if (existing) {
    return {
      success: existing.state === 'reserved',
      remaining_stock: 0,
      message: existing.state === 'reserved' ? 'Stock was already reserved for this order.' : 'Reservation is no longer active.'
    };
  }

  try {
    await InventoryReservation.create({ orderId: reservationId, productId, quantity, state: 'reserved' });
    const product = await Product.findOneAndUpdate(
      { _id: productId, stock: { $gte: quantity } },
      { $inc: { stock: -quantity } },
      { new: true }
    );
    if (!product) {
      await InventoryReservation.deleteOne({ orderId: reservationId, state: 'reserved' });
      return { success: false, remaining_stock: 0, message: 'Not enough stock available.' };
    }
    return { success: true, remaining_stock: product.stock };
  } catch (_error) {
    return { success: false, remaining_stock: 0 };
  }
}

async function restoreStock(productId, quantity, reservationId) {
  if (!Number.isInteger(quantity) || quantity <= 0 || !reservationId) return { success: false, remaining_stock: 0 };

  const reservation = await InventoryReservation.findOne({ orderId: reservationId, productId, quantity });
  if (!reservation) return { success: false, remaining_stock: 0, message: 'Reservation was not found.' };
  if (reservation.state === 'compensated') return { success: true, already_compensated: true, message: 'Reservation was already restored.' };

  // The product keeps completed compensation IDs. The conditional update makes the stock increment idempotent.
  const product = await Product.findOneAndUpdate(
    { _id: productId, compensatedReservationIds: { $ne: reservationId } },
    { $inc: { stock: quantity }, $addToSet: { compensatedReservationIds: reservationId } },
    { new: true }
  );

  if (!product) {
    const current = await Product.findById(productId);
    if (!current || !current.compensatedReservationIds?.includes(reservationId)) {
      return { success: false, remaining_stock: 0, message: 'Inventory restoration could not be confirmed.' };
    }
  }

  const confirmedProduct = product || await Product.findById(productId);
  await InventoryReservation.updateOne(
    { orderId: reservationId, state: { $ne: 'compensated' } },
    { $set: { state: 'compensated', compensatedAt: new Date() } }
  );
  return { success: true, remaining_stock: confirmedProduct.stock, already_compensated: !product };
}

async function seedProducts() {
  if (await Product.countDocuments() === 0) {
    await Product.insertMany([
      { name: 'Notebook', stock: 20 },
      { name: 'Coffee Mug', stock: 15 },
      { name: 'Desk Lamp', stock: 10 }
    ]);
    console.log('Seeded sample products');
  }
}

module.exports = { reduceStock, restoreStock, seedProducts };
