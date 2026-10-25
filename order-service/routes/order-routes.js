const express = require('express');
const { randomUUID } = require('crypto');
const Order = require('../models/order');
const { reduceStock, restoreStock } = require('../grpc/inventory-client');
const { publishOrderCreated } = require('../messaging/order-events');
const router = express.Router();

async function compensateOrder(order) {
  const restored = await restoreStock(order.productId, order.quantity, order.reservationId);
  if (!restored.success) {
    await Order.updateOne({ _id: order._id }, { $set: { status: 'compensation_pending', 'saga.compensation': 'pending', 'saga.message': restored.message || 'Inventory restoration failed.', 'saga.updatedAt': new Date() } });
    return { success: false, restored };
  }
  await Order.updateOne({ _id: order._id, status: { $in: ['compensation_pending', 'payment_processing'] } }, { $set: { status: 'compensated', 'saga.compensation': 'completed', 'saga.message': 'Payment failed and reserved inventory was restored.', 'saga.updatedAt': new Date() } });
  return { success: true, restored };
}

router.post('/', async (req, res) => {
  const { productId, quantity, customerName, userEmail } = req.body;
  if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Quantity must be positive' });
  if (!userEmail) return res.status(400).json({ error: 'Customer email is required' });
  const reservationId = randomUUID();
  let stockReserved = false;
  try {
    const inventoryResponse = await fetch('http://inventory-service:4001/products');
    const products = await inventoryResponse.json();
    if (!inventoryResponse.ok) throw new Error(products.error || 'Inventory request failed');
    const product = products.find((item) => item._id === productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const stock = await reduceStock(productId, quantity, reservationId);
    if (!stock.success) return res.status(400).json({ error: stock.message || 'Not enough stock available' });
    stockReserved = true;
    if (req.body.simulateSagaFailure === true) throw new Error('Simulated failure while saving the order');
    const order = await Order.create({ productId, productName: product.name, quantity, customerName, userEmail, status: 'pending_payment', reservationId, saga: { paymentOutcome: 'not_attempted', compensation: 'not_needed', updatedAt: new Date() }, createdAt: new Date() });
    stockReserved = false;
    await publishOrderCreated(order);
    return res.status(201).json(order);
  } catch (error) {
    if (stockReserved) {
      const restored = await restoreStock(productId, quantity, reservationId);
      return res.status(restored.success ? 502 : 500).json({ error: error.message + '. ' + (restored.success ? 'Saga compensation restored the stock.' : 'Saga compensation could not restore stock.'), sagaCompensated: restored.success });
    }
    return res.status(502).json({ error: 'Order could not be created: ' + error.message });
  }
});

router.post('/:id/pay', async (req, res) => {
  const order = await Order.findOneAndUpdate({ _id: req.params.id, status: 'pending_payment' }, { $set: { status: 'payment_processing', 'saga.paymentOutcome': 'processing', 'saga.updatedAt': new Date() } }, { new: true });
  if (!order) {
    const existing = await Order.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Order not found' });
    return res.status(409).json({ error: 'Order cannot be paid while status is ' + existing.status, order: existing });
  }
  try {
    const paymentResponse = await fetch('http://payment-service:4002/charge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: order._id.toString(), amount: order.quantity, userEmail: order.userEmail, customerName: order.customerName, productName: order.productName, quantity: order.quantity, simulatePaymentFailure: req.body.simulatePaymentFailure === true }) });
    const payment = await paymentResponse.json();
    if (paymentResponse.ok && payment.success) {
      order.status = 'paid'; order.saga = { paymentOutcome: 'succeeded', compensation: 'not_needed', message: 'Payment succeeded; reservation remains committed.', updatedAt: new Date() }; await order.save();
      return res.json({ success: true, transactionId: payment.transactionId, order, saga: { outcome: 'payment_succeeded', stockRestored: false } });
    }
    if (payment.code === 'SIMULATED_PAYMENT_DECLINED') {
      order.status = 'compensation_pending'; order.saga = { paymentOutcome: 'confirmed_failure', compensation: 'pending', message: payment.error, updatedAt: new Date() }; await order.save();
      const compensation = await compensateOrder(order); const finalOrder = await Order.findById(order._id);
      return res.status(compensation.success ? 422 : 502).json({ success: false, code: payment.code, error: compensation.success ? 'Payment failed — inventory restored successfully.' : 'Payment failed, but inventory compensation is pending.', order: finalOrder, saga: { outcome: 'payment_failed', compensationAttempted: true, stockRestored: compensation.success, reservationId: order.reservationId, inventory: compensation.restored } });
    }
    await Order.updateOne({ _id: order._id, status: 'payment_processing' }, { $set: { status: 'payment_outcome_unknown', 'saga.paymentOutcome': 'unknown', 'saga.message': payment.error || 'Payment outcome is unknown; inventory was not restored.', 'saga.updatedAt': new Date() } });
    return res.status(502).json({ error: 'Payment outcome is unknown; inventory was not restored.', order: await Order.findById(order._id), saga: { outcome: 'unknown', stockRestored: false } });
  } catch (error) {
    await Order.updateOne({ _id: order._id, status: 'payment_processing' }, { $set: { status: 'payment_outcome_unknown', 'saga.paymentOutcome': 'unknown', 'saga.message': error.message, 'saga.updatedAt': new Date() } });
    return res.status(502).json({ error: 'Payment outcome is unknown; inventory was not restored.', order: await Order.findById(order._id), saga: { outcome: 'unknown', stockRestored: false } });
  }
});

router.post('/:id/compensate', async (req, res) => {
  const order = await Order.findOneAndUpdate({ _id: req.params.id, status: 'compensation_pending' }, { $set: { 'saga.compensation': 'retrying', 'saga.updatedAt': new Date() } }, { new: true });
  if (!order) return res.status(409).json({ error: 'Only an order with compensation pending can be retried.' });
  const result = await compensateOrder(order);
  return res.status(result.success ? 200 : 502).json({ success: result.success, order: await Order.findById(order._id), compensation: result.restored });
});

router.get('/', async (_req, res) => { try { return res.json(await Order.find().sort({ createdAt: -1 })); } catch (_error) { return res.status(500).json({ error: 'Could not fetch orders' }); } });
router.delete('/:id', async (req, res) => { try { const order = await Order.findByIdAndDelete(req.params.id); if (!order) return res.status(404).json({ error: 'Order not found' }); return res.json({ success: true, order }); } catch (_error) { return res.status(400).json({ error: 'Could not delete order' }); } });
module.exports = router;
