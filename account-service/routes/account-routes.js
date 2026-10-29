const express = require('express');
const { randomUUID } = require('crypto');
const AccountEvent = require('../events/account-event');
const replayAccount = require('../events/replay-account');

const router = express.Router();

async function getAccountEvents(accountId) {
  return AccountEvent.find({ accountId }).sort({ sequence: 1 }).lean();
}

router.get('/', async (_req, res) => {
  try {
    const accountIds = await AccountEvent.distinct('accountId');
    const accounts = await Promise.all(accountIds.map(async (accountId) => {
      return replayAccount(await getAccountEvents(accountId));
    }));
    return res.json({ accounts });
  } catch (error) {
    return res.status(500).json({ error: `Could not rebuild accounts: ${error.message}` });
  }
});

router.post('/', async (_req, res) => {
  try {
    const accountId = randomUUID();
    await AccountEvent.create({
      accountId,
      sequence: 1,
      type: 'AccountOpened',
      amountCents: 0,
      currency: 'USD'
    });

    return res.status(201).json({ account: replayAccount(await getAccountEvents(accountId)) });
  } catch (error) {
    return res.status(500).json({ error: `Could not open account: ${error.message}` });
  }
});

router.get('/:accountId/events', async (req, res) => {
  try {
    const events = await getAccountEvents(req.params.accountId);
    if (events.length === 0) return res.status(404).json({ error: 'Account not found' });
    return res.json({ events });
  } catch (error) {
    return res.status(500).json({ error: `Could not load account events: ${error.message}` });
  }
});

router.get('/:accountId', async (req, res) => {
  try {
    const account = replayAccount(await getAccountEvents(req.params.accountId));
    if (!account) return res.status(404).json({ error: 'Account not found' });
    return res.json({ account });
  } catch (error) {
    return res.status(500).json({ error: `Could not rebuild account: ${error.message}` });
  }
});

router.post('/:accountId/:operation', async (req, res) => {
  const { accountId, operation } = req.params;
  const amountCents = req.body.amountCents;
  const requestedCommandId = typeof req.body.commandId === 'string' ? req.body.commandId.trim() : '';
  const commandId = requestedCommandId || randomUUID();

  if (!['deposit', 'withdraw'].includes(operation)) {
    return res.status(404).json({ error: 'Account operation not found' });
  }
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive whole number of cents' });
  }
  if (commandId.length > 100) {
    return res.status(400).json({ error: 'commandId must be 100 characters or fewer' });
  }

  try {
    const existingEvent = await AccountEvent.findOne({ accountId, commandId }).lean();
    if (existingEvent) {
      return res.json({ event: existingEvent, account: replayAccount(await getAccountEvents(accountId)), reused: true });
    }
    const events = await getAccountEvents(accountId);
    const account = replayAccount(events);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    if (operation === 'withdraw' && amountCents > account.balanceCents) {
      return res.status(400).json({ error: 'Withdrawal is greater than the current balance' });
    }
    if (account.balanceCents + amountCents > Number.MAX_SAFE_INTEGER) {
      return res.status(400).json({ error: 'Balance exceeds the supported amount' });
    }

    const event = await AccountEvent.create({
      accountId,
      sequence: account.version + 1,
      commandId,
      type: operation === 'deposit' ? 'MoneyDeposited' : 'MoneyWithdrawn',
      amountCents,
      currency: account.currency
    });
    const updatedAccount = replayAccount(await getAccountEvents(accountId));

    return res.status(201).json({ event, account: updatedAccount });
  } catch (error) {
    if (error.code === 11000) {
      const existingEvent = await AccountEvent.findOne({ accountId, commandId }).lean();
      if (existingEvent) {
        return res.json({ event: existingEvent, account: replayAccount(await getAccountEvents(accountId)), reused: true });
      }
      return res.status(409).json({ error: 'Another account command was saved at the same time. Refresh and try again.' });
    }
    return res.status(500).json({ error: `Could not record account event: ${error.message}` });
  }
});

module.exports = router;
