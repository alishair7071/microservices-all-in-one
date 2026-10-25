const express = require('express');
const { randomUUID } = require('crypto');
const DemoPaymentAccount = require('../models/demo-payment-account');

const router = express.Router();
const MAX_CENTS = 1000000000;
const validAmount = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_CENTS;
const validId = value => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);

router.use('/idempotency-lab', (request, response, next) => {
  if (process.env.IDEMPOTENCY_LAB_ENABLED !== 'true') return response.sendStatus(404);
  next();
});

router.post('/idempotency-lab/runs', async (request, response) => {
  try {
    const { mode, startingBalanceCents } = request.body || {};
    if (!['protected', 'unprotected'].includes(mode) || !validAmount(startingBalanceCents)) {
      return response.status(400).json({ error: 'Choose a mode and a positive starting balance.' });
    }
    await DemoPaymentAccount.init();
    const account = await DemoPaymentAccount.create({
      runId: randomUUID(), logicalPaymentId: randomUUID(), idempotencyKey: randomUUID(),
      mode, balanceCents: startingBalanceCents
    });
    return response.status(201).json({
      runId: account.runId, logicalPaymentId: account.logicalPaymentId,
      idempotencyKey: account.idempotencyKey, mode: account.mode,
      balanceCents: account.balanceCents, effects: []
    });
  } catch (error) {
    console.error('Could not start idempotency demo account:', error);
    return response.status(500).json({ error: 'Could not start the demo account.' });
  }
});

router.post('/idempotency-lab/runs/:runId/fund', async (request, response) => {
  try {
    const { amountCents } = request.body || {};
    if (!validId(request.params.runId) || !validAmount(amountCents)) {
      return response.status(400).json({ error: 'Enter a valid amount to add.' });
    }
    const account = await DemoPaymentAccount.findOneAndUpdate(
      { runId: request.params.runId, balanceCents: { $lte: MAX_CENTS - amountCents } },
      { $inc: { balanceCents: amountCents } }, { new: true }
    );
    if (!account) return response.status(404).json({ error: 'Account not found or balance limit reached.' });
    return response.json({ balanceCents: account.balanceCents });
  } catch (error) {
    console.error('Could not fund idempotency demo account:', error);
    return response.status(500).json({ error: 'Could not add money to the demo account.' });
  }
});

router.post('/idempotency-lab/payments', async (request, response) => {
  try {
    const { runId, logicalPaymentId, idempotencyKey, amountCents, currency, simulateLostResponse } = request.body || {};
    if (!validId(runId) || !validId(logicalPaymentId) || !validId(idempotencyKey) ||
        !validAmount(amountCents) || currency !== 'PKR' || typeof simulateLostResponse !== 'boolean') {
      return response.status(400).json({ error: 'Invalid demo payment request.' });
    }
    const account = await DemoPaymentAccount.findOne({ runId });
    if (!account) return response.status(404).json({ error: 'Demo account not found.' });
    if (account.logicalPaymentId !== logicalPaymentId || account.idempotencyKey !== idempotencyKey) {
      return response.status(409).json({ error: 'This payment does not belong to this demo account.' });
    }
    const original = account.mode === 'protected'
      ? account.effects.find(effect => effect.idempotencyKey === idempotencyKey) : null;
    if (original && (original.amountCents !== amountCents || original.currency !== currency ||
        original.logicalPaymentId !== logicalPaymentId)) {
      return response.status(409).json({ error: 'The same idempotency key cannot be used for a different payment.' });
    }

    const candidate = {
      transactionId: randomUUID(), logicalPaymentId,
      idempotencyKey: account.mode === 'protected' ? idempotencyKey : undefined,
      amountCents, currency, createdAt: new Date()
    };
    const filter = { runId, balanceCents: { $gte: amountCents }, 'effects.99': { $exists: false } };
    if (account.mode === 'protected') filter['effects.idempotencyKey'] = { $ne: idempotencyKey };
    const updated = await DemoPaymentAccount.findOneAndUpdate(
      filter, { $inc: { balanceCents: -amountCents }, $push: { effects: candidate } }, { new: true }
    );
    const current = updated || await DemoPaymentAccount.findOne({ runId });
    const saved = updated ? current.effects.find(effect => effect.transactionId === candidate.transactionId)
      : current && account.mode === 'protected'
        ? current.effects.find(effect => effect.idempotencyKey === idempotencyKey) : null;
    if (!saved) {
      return response.status(409).json({ error: current && current.balanceCents < amountCents
        ? 'Insufficient demo account balance.' : 'Demo account payment limit reached.' });
    }
    if (saved.amountCents !== amountCents || saved.currency !== currency || saved.logicalPaymentId !== logicalPaymentId) {
      return response.status(409).json({ error: 'The same idempotency key cannot be used for a different payment.' });
    }
    const result = {
      transactionId: saved.transactionId, logicalPaymentId, amountCents, currency,
      deduplicated: !updated, balanceCents: current.balanceCents,
      serverSidePaymentEffects: current.effects.length
    };
    if (simulateLostResponse) {
      response.destroy();
      return;
    }
    return response.status(updated ? 201 : 200).json(result);
  } catch (error) {
    console.error('Could not process idempotency demo payment:', error);
    return response.status(500).json({ error: 'Could not process the demo payment.' });
  }
});

router.get('/idempotency-lab/runs/:runId', async (request, response) => {
  try {
    if (!validId(request.params.runId)) return response.status(400).json({ error: 'Invalid demo account ID.' });
    const account = await DemoPaymentAccount.findOne({ runId: request.params.runId }).lean();
    if (!account) return response.status(404).json({ error: 'Demo account not found.' });
    return response.json({
      runId: account.runId, logicalPaymentId: account.logicalPaymentId,
      idempotencyKey: account.idempotencyKey, mode: account.mode,
      balanceCents: account.balanceCents, serverSidePaymentEffects: account.effects.length,
      effects: account.effects
    });
  } catch (error) {
    console.error('Could not read idempotency demo account:', error);
    return response.status(500).json({ error: 'Could not read the demo account.' });
  }
});

module.exports = router;
