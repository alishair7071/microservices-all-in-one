const express = require('express');
const { randomUUID } = require('crypto');
const Payment = require('../models/payment');
const { publishPaymentApproved } = require('../kafka/kafka-producer');

const router = express.Router();

router.post('/charge', async (req, res) => {
  if (req.body.simulatePaymentFailure === true) {
    return res.status(422).json({
      success: false,
      code: 'SIMULATED_PAYMENT_DECLINED',
      error: 'Payment was deliberately declined for the local Saga demonstration.'
    });
  }

  try {
    const transactionId = randomUUID();
    const payment = await Payment.create({
      orderId: req.body.orderId,
      amount: req.body.amount,
      status: 'succeeded',
      transactionId,
      createdAt: new Date()
    });
    await publishPaymentApproved(payment, {
      userEmail: req.body.userEmail,
      customerName: req.body.customerName,
      productName: req.body.productName,
      quantity: req.body.quantity
    });
    res.json({ success: true, transactionId });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Could not process payment' });
  }
});

module.exports = router;
