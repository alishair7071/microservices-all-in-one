function replayAccount(events) {
  if (events.length === 0) return null;

  const account = {
    accountId: events[0].accountId,
    balanceCents: 0,
    currency: 'USD',
    version: 0,
    openedAt: events[0].occurredAt
  };

  for (const event of events) {
    if (event.sequence !== account.version + 1) {
      throw new Error('Account event sequence is incomplete.');
    }

    if (account.version === 0 && event.type !== 'AccountOpened') {
      throw new Error('AccountOpened must be the first event.');
    }
    if (event.type === 'AccountOpened') {
      if (event.sequence !== 1) throw new Error('AccountOpened must be the first event.');
      if (event.amountCents !== 0) throw new Error('AccountOpened must not change the balance.');
      account.currency = event.currency;
    } else if (event.type === 'MoneyDeposited') {
      account.balanceCents += event.amountCents;
    } else if (event.type === 'MoneyWithdrawn') {
      account.balanceCents -= event.amountCents;
    } else {
      throw new Error(`Unknown account event: ${event.type}`);
    }

    account.version = event.sequence;
  }

  return account;
}

module.exports = replayAccount;
