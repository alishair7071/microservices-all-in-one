// HTML elements we update from JavaScript.
const productsList = document.querySelector('#products');
const productSelect = document.querySelector('#product-id');
const ordersList = document.querySelector('#orders');
const message = document.querySelector('#message');
const gatewayTestResult = document.querySelector('#gateway-test-result');
const circuitBreakerResult = document.querySelector('#circuit-breaker-result');
const retryDemoResult = document.querySelector('#retry-demo-result');
const bulkheadDemoResult = document.querySelector('#bulkhead-demo-result');
const otelTraceResult = document.querySelector('#otel-trace-result');
const eventAccountSelect = document.querySelector('#event-account-select');
const eventAccountAmount = document.querySelector('#event-account-amount');
const eventAccountMessage = document.querySelector('#event-account-message');
const eventAccountSummary = document.querySelector('#event-account-summary');
const eventAccountHistory = document.querySelector('#event-account-history');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function emptyState(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function updateMetric(id, value) {
  document.querySelector(`#${id}`).textContent = value;
}

function displayValue(value) {
  return value === undefined || value === null || value === '' ? '—' : escapeHtml(value);
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return escapeHtml(timestamp);
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

// Show a green success message or a red error message below the order form.
function showMessage(text, isError = false) {
  message.textContent = text;
  message.className = isError ? 'message error' : 'message';
}

function showGatewayTestResult(title, detail, isError = false) {
  gatewayTestResult.innerHTML = `
    <div class="gateway-result ${isError ? 'error' : ''}">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(detail)}</span>
    </div>
  `;
}

function showCircuitBreakerResult(data, isError = false) {
  const breaker = data.breaker || {};
  const title = data.result?.message || data.message || 'Circuit breaker status';
  circuitBreakerResult.innerHTML = `
    <div class="gateway-result ${isError ? 'error' : ''}">
      <strong>${escapeHtml(title)}</strong>
      <span>State: ${escapeHtml(breaker.state || 'unknown')} · Last event: ${escapeHtml(breaker.lastEvent || 'unknown')}</span>
      <span>Requests: ${displayValue(breaker.totalRequests)} · Successes: ${displayValue(breaker.successfulRequests)} · Failures: ${displayValue(breaker.failedRequests)} · Rejected: ${displayValue(breaker.rejectedRequests)}</span>
      <span>Timeout: ${displayValue(breaker.timeoutMs)}ms · Recovery test after: ${displayValue(breaker.resetAfterMs)}ms</span>
    </div>
  `;
}

async function runCircuitBreakerDemo() {
  const delayMs = document.querySelector('#circuit-response-mode').value;
  try {
    const response = await fetch(`http://localhost:8000/api/circuit-breaker-demo?delayMs=${encodeURIComponent(delayMs)}`);
    const data = await response.json();
    showCircuitBreakerResult(data, !response.ok);
  } catch (error) {
    showCircuitBreakerResult({ message: `Request could not be sent: ${error.message}` }, true);
  }
}

async function runRetryDemo() {
  const button = document.querySelector('#send-retry-request');
  button.disabled = true;
  retryDemoResult.innerHTML = '<div class="gateway-result">Resilience Lab Service is making the attempts...</div>';

  try {
    const response = await fetch('http://localhost:8000/api/retry-demo');
    const data = await response.json();
    retryDemoResult.innerHTML = `
      <div class="gateway-result ${response.ok ? '' : 'error'}">
        <strong>${escapeHtml(data.message || 'Retry request failed')}</strong>
        ${(data.attempts || []).map((attempt) => `
          <span>Attempt ${escapeHtml(attempt.number)}: ${escapeHtml(attempt.status)} — ${escapeHtml(attempt.message)}${attempt.waitMs === undefined ? '' : ` — waited ${escapeHtml(attempt.waitMs)} ms before the next attempt`}</span>
        `).join('')}
      </div>
    `;
  } catch (error) {
    retryDemoResult.innerHTML = `<div class="gateway-result error">${escapeHtml(`Request could not reach the Resilience Lab Service: ${error.message}`)}</div>`;
  } finally {
    button.disabled = false;
  }
}

async function runBulkheadDemo() {
  const button = document.querySelector('#send-bulkhead-requests');
  const results = Array(5).fill(null);
  button.disabled = true;
  bulkheadDemoResult.innerHTML = '<div class="gateway-result">Sending five requests at the same time...</div>';

  await Promise.all(results.map(async (_result, index) => {
    try {
      const requestId = `${Date.now()}-${index + 1}`;
      const response = await fetch(`http://localhost:8000/api/bulkhead-demo?request=${requestId}`, { cache: 'no-store' });
      const data = await response.json();
      results[index] = {
        success: response.ok,
        message: data.message || (response.ok ? 'Target responded.' : 'Request was rejected.'),
        status: response.status
      };
    } catch (error) {
      results[index] = { success: false, message: error.message, status: 'NETWORK_ERROR' };
    }

    bulkheadDemoResult.innerHTML = results.map((result, resultIndex) => `
      <div class="gateway-result ${result && !result.success ? 'error' : ''}">
        <strong>Request ${resultIndex + 1}: ${result ? escapeHtml(result.status) : 'waiting'}</strong>
        <span>${result ? escapeHtml(result.message) : 'Waiting for a response...'}</span>
      </div>
    `).join('');
  }));

  button.disabled = false;
}

async function runOtelTraceDemo() {
  const button = document.querySelector('#send-otel-trace');
  const failTarget = document.querySelector('#fail-otel-trace-target').checked;
  button.disabled = true;
  otelTraceResult.innerHTML = '<div class="gateway-result">Following the request...</div>';

  try {
    const url = `http://localhost:8000/api/otel-trace-demo${failTarget ? '?failTarget=1' : ''}`;
    const response = await fetch(url, { method: 'POST' });
    const data = await response.json();
    otelTraceResult.innerHTML = `
      <div class="gateway-result ${response.ok ? '' : 'error'}">
        <strong>${escapeHtml(data.error || (response.ok ? 'Record saved and read from MongoDB' : 'Request failed'))}</strong>
        ${data.record ? `<span>MongoDB record: ${escapeHtml(data.record.id)} · ${escapeHtml(formatTimestamp(data.record.createdAt))}</span>` : ''}
        <a href="http://localhost:16686/" target="_blank" rel="noopener noreferrer">Open Jaeger: service resilience-lab-service, operation POST /trace-demo</a>
      </div>
    `;
  } catch (error) {
    otelTraceResult.innerHTML = `<div class="gateway-result error">${escapeHtml(error.message)}</div>`;
  } finally {
    button.disabled = false;
  }
}

function formatAccountMoney(amountCents) {
  return `USD ${(amountCents / 100).toFixed(2)}`;
}

async function loadEventSourcingAccount() {
  const accountId = eventAccountSelect.value;
  if (!accountId) {
    eventAccountSummary.innerHTML = emptyState('Open a demo account to begin.');
    eventAccountHistory.innerHTML = '';
    return;
  }

  try {
    const [accountResponse, eventsResponse] = await Promise.all([
      fetch(`http://localhost:8000/api/accounts/${accountId}`),
      fetch(`http://localhost:8000/api/accounts/${accountId}/events`)
    ]);
    const accountData = await accountResponse.json();
    const eventsData = await eventsResponse.json();
    if (!accountResponse.ok) throw new Error(accountData.error || 'Could not load account');
    if (!eventsResponse.ok) throw new Error(eventsData.error || 'Could not load account history');

    const account = accountData.account;
    eventAccountSummary.innerHTML = `
      <div class="gateway-result">
        <strong>Current balance: ${escapeHtml(formatAccountMoney(account.balanceCents))}</strong>
        <span>Rebuilt from ${escapeHtml(account.version)} event(s) · Account ${escapeHtml(account.accountId)}</span>
      </div>
    `;
    eventAccountHistory.innerHTML = eventsData.events.map((event) => `
      <div class="gateway-result">
        <strong>#${escapeHtml(event.sequence)} · ${escapeHtml(event.type)}</strong>
        <span>${escapeHtml(event.type === 'AccountOpened' ? 'Account opened' : formatAccountMoney(event.amountCents))} · ${escapeHtml(formatTimestamp(event.occurredAt))}</span>
      </div>
    `).join('');
  } catch (error) {
    eventAccountSummary.innerHTML = `<div class="gateway-result error">${escapeHtml(error.message)}</div>`;
  }
}

async function loadEventSourcingAccounts(preferredAccountId = '') {
  try {
    const response = await fetch('http://localhost:8000/api/accounts');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load accounts');

    const oldAccountId = eventAccountSelect.value;
    eventAccountSelect.innerHTML = data.accounts.map((account) => `
      <option value="${escapeHtml(account.accountId)}">${escapeHtml(account.accountId.slice(0, 8))} · ${escapeHtml(formatAccountMoney(account.balanceCents))}</option>
    `).join('');
    eventAccountSelect.value = preferredAccountId || oldAccountId;
    if (!eventAccountSelect.value && data.accounts.length > 0) {
      eventAccountSelect.value = data.accounts[0].accountId;
    }
    await loadEventSourcingAccount();
  } catch (error) {
    eventAccountSummary.innerHTML = `<div class="gateway-result error">${escapeHtml(error.message)}</div>`;
  }
}

async function openEventSourcingAccount() {
  try {
    const response = await fetch('http://localhost:8000/api/accounts', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not open account');
    await loadEventSourcingAccounts(data.account.accountId);
    eventAccountMessage.textContent = 'Demo account opened; AccountOpened was appended to the event history.';
    eventAccountMessage.className = 'message';
  } catch (error) {
    eventAccountMessage.textContent = error.message;
    eventAccountMessage.className = 'message error';
  }
}

async function changeEventSourcingBalance(operation) {
  const accountId = eventAccountSelect.value;
  const amount = Number(eventAccountAmount.value);
  const amountCents = Math.round(amount * 100);
  if (!accountId) {
    eventAccountMessage.textContent = 'Open or select an account first.';
    eventAccountMessage.className = 'message error';
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(amountCents)) {
    eventAccountMessage.textContent = 'Enter a valid amount greater than zero.';
    eventAccountMessage.className = 'message error';
    return;
  }

  try {
    const response = await fetch(`http://localhost:8000/api/accounts/${accountId}/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Could not ${operation} money`);
    await loadEventSourcingAccounts(accountId);
    eventAccountAmount.value = '';
    eventAccountMessage.textContent = `${data.event.type} appended. Current balance: ${formatAccountMoney(data.account.balanceCents)}.`;
    eventAccountMessage.className = 'message';
  } catch (error) {
    eventAccountMessage.textContent = error.message;
    eventAccountMessage.className = 'message error';
  }
}

async function testLoadBalancing() {
  try {
    const response = await fetch('http://localhost:8000/api/load-balanced/email-health');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Gateway request failed');

    showGatewayTestResult(
      'Load-balanced request accepted',
      `Kong selected ${data.instance || 'an Email Service instance'}. Click again to observe round-robin routing.`
    );
  } catch (error) {
    showGatewayTestResult('Load-balancing request failed', error.message, true);
  }
}

async function testRateLimit() {
  try {
    const response = await fetch('http://localhost:8000/api/rate-limit-test');
    const data = await response.json();
    const limit = response.headers.get('X-RateLimit-Limit-Minute') || '5';
    const remaining = response.headers.get('X-RateLimit-Remaining-Minute');

    if (!response.ok) {
      showGatewayTestResult(
        `Rate limit blocked the request (${response.status})`,
        `Kong allows ${limit} requests per minute on this test route. Wait one minute and try again.`,
        true
      );
      return;
    }

    showGatewayTestResult(
      'Rate-limited request accepted',
      `Kong allowed this request. Remaining this minute: ${remaining ?? 'unknown'} of ${limit}.`
    );
  } catch (error) {
    showGatewayTestResult('Rate-limit request failed', error.message, true);
  }
}

// Kong forwards this request to Inventory Service.
// The product list also fills the order dropdown.
async function loadProducts() {
  const response = await fetch('http://localhost:8000/api/products');
  const products = await response.json();

  if (!response.ok) {
    throw new Error(products.error || 'Could not fetch products');
  }

  updateMetric('product-count', products.length);
  updateMetric('stock-count', products.reduce((total, product) => total + product.stock, 0));

  productsList.innerHTML = products.length
    ? products.map((product) => `
        <div class="product-item">
          <div><div class="item-title">${escapeHtml(product.name)}</div><div class="item-meta">Inventory service / REST</div></div>
          <div class="item-actions"><span class="stock ${product.stock < 5 ? 'low' : ''}">${product.stock} in stock</span><button class="delete" type="button" data-delete-product="${escapeHtml(product._id)}">Delete</button></div>
        </div>
      `).join('')
    : emptyState('No products yet. Add the first item above.');

  productSelect.innerHTML = products
    .map((product) => `<option value="${escapeHtml(product._id)}" ${product.stock === 0 ? 'disabled' : ''}>${escapeHtml(product.name)} (${product.stock} available)</option>`).join('');
}

// Render the emails returned by the Email Service through Kong.
function renderEmails(emails, instanceName) {
  return emails.length
    ? emails.slice().reverse().map((email) => `
        <div class="event-item">
          <span class="event-mark mail">@</span>
          <div class="event-copy">
            <div class="item-title">Email sent to ${escapeHtml(email.to)}</div>
            <div class="item-meta">Subject: ${escapeHtml(email.subject)} / order: ${escapeHtml(email.orderId)}</div>
            <div class="item-meta">Consumed by: ${escapeHtml(email.consumedBy || instanceName)} / ${escapeHtml(email.createdAt)}</div>
          </div>
        </div>
      `).join('')
    : emptyState(`No emails consumed by ${instanceName} yet.`);
}

function renderKafkaEmails(emails, instanceName) {
  return emails.length
    ? emails.slice().reverse().map((email) => `
        <div class="event-item kafka-event">
          <span class="event-mark mail">K</span>
          <div class="event-copy">
            <div class="item-title">Payment approved for ${displayValue(email.customerName)}</div>
            <div class="item-meta">Email: ${displayValue(email.to)} · Product: ${displayValue(email.productName)} × ${displayValue(email.quantity)}</div>
            <div class="event-details">
              <span><b>Amount</b>${displayValue(email.amount)}</span>
              <span><b>Event created</b>${formatTimestamp(email.eventCreatedAt)}</span>
              <span><b>Consumed</b>${formatTimestamp(email.consumedAt || email.createdAt)}</span>
              <span><b>Consumer</b>${displayValue(email.consumedBy || instanceName)}</span>
            </div>
            <div class="item-meta event-id">Order: ${displayValue(email.orderId)} · Payment: ${displayValue(email.paymentId)}</div>
          </div>
        </div>
      `).join('')
    : emptyState(`No Kafka events consumed by ${instanceName} yet.`);
}

function renderKafkaNotifications(notifications) {
  return notifications.length
    ? notifications.slice().reverse().map((notification) => `
        <div class="event-item kafka-event">
          <span class="event-mark">K</span>
          <div class="event-copy">
            <div class="item-title">Payment approved for ${displayValue(notification.customerName)}</div>
            <div class="item-meta">Product: ${displayValue(notification.productName)} × ${displayValue(notification.quantity)}</div>
            <div class="event-details">
              <span><b>Amount</b>${displayValue(notification.amount)}</span>
              <span><b>Event created</b>${formatTimestamp(notification.eventCreatedAt)}</span>
              <span><b>Consumed</b>${formatTimestamp(notification.consumedAt || notification.createdAt)}</span>
              <span><b>Consumer</b>${displayValue(notification.consumedBy)}</span>
            </div>
            <div class="item-meta event-id">Order: ${displayValue(notification.orderId)} · Payment: ${displayValue(notification.paymentId)}</div>
          </div>
        </div>
      `).join('')
    : emptyState('No Kafka notifications received yet.');
}

async function loadEmailInstance(api, elementId, instanceName) {
  const response = await fetch(api);
  const emails = await response.json();

  if (!response.ok) throw new Error(emails.error || `Could not fetch ${instanceName} emails`);
  document.querySelector(`#${elementId}`).innerHTML = renderEmails(emails, instanceName);
  return emails.length;
}

// Fetch both local in-memory email lists. RabbitMQ decides which instance receives each message.
async function loadEmails() {
  try {
    const [emailCountA, emailCountB] = await Promise.all([
      loadEmailInstance('http://localhost:8000/api/emails/a', 'emails-a', 'email-service-A'),
      loadEmailInstance('http://localhost:8000/api/emails/b', 'emails-b', 'email-service-B')
    ]);

    currentEmailCount = emailCountA + emailCountB;
    updateMetric('event-count', currentEmailCount + currentNotificationCount + currentKafkaEmailCount + currentKafkaNotificationCount);
  } catch (error) {
    console.error('Could not fetch emails:', error);
  }
}

async function loadKafkaEmails() {
  try {
    const [responseA, responseB] = await Promise.all([
      fetch('http://localhost:8000/api/kafka/emails/a'),
      fetch('http://localhost:8000/api/kafka/emails/b')
    ]);
    const [dataA, dataB] = await Promise.all([responseA.json(), responseB.json()]);
    if (!responseA.ok || !responseB.ok) throw new Error('Could not fetch Kafka email events');

    document.querySelector('#kafka-emails-a').innerHTML = renderKafkaEmails(dataA.emails, 'email-service-A');
    document.querySelector('#kafka-emails-b').innerHTML = renderKafkaEmails(dataB.emails, 'email-service-B');
    currentKafkaEmailCount = dataA.emails.length + dataB.emails.length;
    updateMetric('event-count', currentEmailCount + currentNotificationCount + currentKafkaEmailCount + currentKafkaNotificationCount);
  } catch (error) {
    console.error('Could not fetch Kafka emails:', error);
  }
}

// Fetch all notifications from notification-service and render them.
async function loadNotifications() {
  try {
    const response = await fetch('http://localhost:8000/api/notifications');
    const notifications = await response.json();

    currentNotificationCount = notifications.length;
    updateMetric('event-count', currentEmailCount + currentNotificationCount + currentKafkaEmailCount + currentKafkaNotificationCount);
    const notificationsHtml = notifications.length
      ? notifications.slice().reverse().map((n) => `
        <div class="event-item">
          <span class="event-mark">!</span>
          <div class="event-copy"><div class="item-title">Notification for ${escapeHtml(n.userName)}</div><div class="item-meta">${escapeHtml(n.message)}</div></div>
        </div>
      `).join('')
      : emptyState('No notification events received yet.');

    document.querySelector('#notifications').innerHTML = notificationsHtml;
  } catch (error) {
    console.error('Could not fetch notifications:', error);
  }
}

async function loadKafkaNotifications() {
  try {
    const response = await fetch('http://localhost:8000/api/kafka/notifications');
    const data = await response.json();
    if (!response.ok) throw new Error('Could not fetch Kafka notifications');

    document.querySelector('#kafka-notifications').innerHTML = renderKafkaNotifications(data.notifications);
    currentKafkaNotificationCount = data.notifications.length;
    updateMetric('event-count', currentEmailCount + currentNotificationCount + currentKafkaEmailCount + currentKafkaNotificationCount);
  } catch (error) {
    console.error('Could not fetch Kafka notifications:', error);
  }
}

let currentEmailCount = 0;
let currentNotificationCount = 0;
let currentKafkaEmailCount = 0;
let currentKafkaNotificationCount = 0;

// Fetch all saved orders from order-service and render them.
// A Pay button is shown only while an order is waiting for payment.
async function loadOrders() {
  const response = await fetch('http://localhost:8000/api/orders');
  const orders = await response.json();
  if (!response.ok) throw new Error(orders.error || 'Could not fetch orders');

  updateMetric('order-count', orders.length);
  ordersList.innerHTML = orders.length ? orders.map((order) => {
      const payButton = order.status === 'pending_payment'
        ? `<button class="pay" data-pay-id="${escapeHtml(order._id)}">Pay</button>`
        : '';

      return `<div class="order-item"><div><div class="item-title">${escapeHtml(order.productName)} <span class="item-meta">x ${order.quantity}</span></div><div class="item-meta">For ${escapeHtml(order.customerName)} / ${escapeHtml(order._id)}</div></div><div class="item-actions">${payButton}<span class="status ${escapeHtml(order.status)}">${escapeHtml(order.status.replace('_', ' '))}</span><button class="delete" type="button" data-delete-order="${escapeHtml(order._id)}">Delete</button></div></div>`;
    }).join('') : emptyState('No orders yet. Create one to start the flow.');
}

// Add a product through Kong's Inventory route.
document.querySelector('#product-form').addEventListener('submit', async (event) => {
  event.preventDefault(); // Keep the page from reloading.

  const form = new FormData(event.target);
  const newProduct = {
    name: form.get('name'),
    stock: Number(form.get('stock'))
  };

  try {
    const response = await fetch('http://localhost:8000/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newProduct)
    });
    const product = await response.json();

    if (!response.ok) {
      throw new Error(product.error || 'Could not create product');
    }

    event.target.reset();
    showMessage('Product added.');
    await loadProducts(); // Refresh stock list and order dropdown.
  } catch (error) {
    showMessage(error.message, true);
  }
});

productsList.addEventListener('click', async (event) => {
  const productId = event.target.closest('[data-delete-product]')?.dataset.deleteProduct;
  if (!productId || !window.confirm('Delete this product?')) return;

  try {
    const response = await fetch(`http://localhost:8000/api/products/${productId}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not delete product');
    showMessage('Product deleted.');
    await loadProducts();
  } catch (error) {
    showMessage(error.message, true);
  }
});

// Create an order. This reduces inventory and saves an unpaid order.
document.querySelector('#order-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const form = new FormData(event.target);
  const newOrder = {
    productId: productSelect.value,
    quantity: Number(form.get('quantity')),
    customerName: form.get('customerName'),
    userEmail: form.get('userEmail'),
    simulateSagaFailure: form.get('simulateSagaFailure') === 'on'
  };

  try {
    const response = await fetch('http://localhost:8000/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newOrder)
    });
    const order = await response.json();
    if (!response.ok) {
      if (order.sagaCompensated) await loadProducts();
      throw new Error(order.error || 'Could not create order');
    }

    event.target.reset();
    showMessage(`Order ${order._id} created. Click Pay when ready.`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await Promise.all([loadProducts(), loadOrders(), loadEmails(), loadNotifications(), loadKafkaEmails(), loadKafkaNotifications()]);
  } catch (error) {
    showMessage(error.message, true);
  }
});

// Use one click listener for every current/future Pay button in the order list.
ordersList.addEventListener('click', async (event) => {
  const orderId = event.target.closest('[data-pay-id]')?.dataset.payId;
  const deleteOrderId = event.target.closest('[data-delete-order]')?.dataset.deleteOrder;

  if (deleteOrderId) {
    if (!window.confirm('Delete this order?')) return;

    try {
      const response = await fetch(`http://localhost:8000/api/orders/${deleteOrderId}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not delete order');
      showMessage(result.success ? 'Order deleted.' : 'Could not delete order.', !result.success);
      await loadOrders();
    } catch (error) {
      showMessage(error.message, true);
    }
    return;
  }

  // Ignore clicks that were not on a Pay button.
  if (!orderId) return;

  try {
    const response = await fetch(`http://localhost:8000/api/orders/${orderId}/pay`, {
      method: 'POST'
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not pay for order');

    showMessage(`Payment successful. Transaction: ${result.transactionId}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await Promise.all([loadOrders(), loadEmails(), loadNotifications(), loadKafkaEmails(), loadKafkaNotifications()]);
  } catch (error) {
    showMessage(error.message, true);
  }
});

// Refresh button and initial page load.
document.querySelector('#refresh-orders').addEventListener('click', loadOrders);
document.querySelector('#test-load-balancing').addEventListener('click', testLoadBalancing);
document.querySelector('#test-rate-limit').addEventListener('click', testRateLimit);
document.querySelector('#send-circuit-request').addEventListener('click', runCircuitBreakerDemo);
document.querySelector('#send-retry-request').addEventListener('click', runRetryDemo);
document.querySelector('#send-bulkhead-requests').addEventListener('click', runBulkheadDemo);
document.querySelector('#send-otel-trace').addEventListener('click', runOtelTraceDemo);
document.querySelector('#open-demo-account').addEventListener('click', openEventSourcingAccount);
document.querySelector('#event-account-select').addEventListener('change', loadEventSourcingAccount);
document.querySelector('#deposit-account-money').addEventListener('click', () => changeEventSourcingBalance('deposit'));
document.querySelector('#withdraw-account-money').addEventListener('click', () => changeEventSourcingBalance('withdraw'));

Promise.all([loadProducts(), loadOrders(), loadEmails(), loadNotifications(), loadKafkaEmails(), loadKafkaNotifications(), loadEventSourcingAccounts()])
  .catch((error) => showMessage(error.message, true));

// Dashboard navigation only changes visibility. Existing lab controls, DOM nodes, and API functions remain shared.
const labRegistry = {
  overview: { workspace: 'overview', title: 'Lab directory' },
  commerce: { workspace: 'commerce', title: 'Commerce workflow & Saga' },
  saga: { workspace: 'commerce', title: 'Saga compensation' },
  rabbitmq: { workspace: 'rabbitmq', title: 'RabbitMQ' },
  kafka: { workspace: 'kafka', title: 'Kafka' },
  gateway: { workspace: 'gateway', title: 'API Gateway' },
  'rate-limiting': { workspace: 'gateway', title: 'Rate limiting' },
  circuit: { workspace: 'circuit', title: 'Circuit breaker' },
  timeouts: { workspace: 'circuit', title: 'Timeouts' },
  retry: { workspace: 'retry', title: 'Retry' },
  bulkhead: { workspace: 'bulkhead', title: 'Bulkhead' },
  'event-sourcing': { workspace: 'event-sourcing', title: 'Event sourcing' },
  observability: { workspace: 'observability', title: 'Observability' },
  idempotency: { workspace: 'idempotency', title: 'Idempotency (planned)' },
  'load-shedding': { workspace: 'load-shedding', title: 'Load shedding (planned)' }
};

const labViews = [...document.querySelectorAll('[data-lab]')];
const labLinks = [...document.querySelectorAll('[data-lab-link]')];
const focusModeToggle = document.querySelector('#focus-mode-toggle');

function getRequestedLab() {
  const requested = window.location.hash.slice(1);
  return labRegistry[requested] ? requested : 'overview';
}

function selectLab(labId, updateHash = true) {
  const lab = labRegistry[labId] || labRegistry.overview;

  labViews.forEach((view) => {
    view.hidden = view.dataset.lab !== lab.workspace;
  });

  labLinks.forEach((link) => {
    link.classList.toggle('active', (link.dataset.navKey || link.dataset.labLink) === labId);
  });

  document.title = lab.title + ' - Beyond Microservices Live Labs';

  if (updateHash && window.location.hash !== '#' + labId) {
    window.location.hash = labId;
  }
}

labLinks.forEach((link) => {
  link.addEventListener('click', () => selectLab(link.dataset.navKey || link.dataset.labLink));
});

window.addEventListener('hashchange', () => selectLab(getRequestedLab(), false));

function setFocusMode(enabled) {
  document.body.classList.toggle('focus-mode', enabled);
  focusModeToggle.setAttribute('aria-pressed', String(enabled));
  focusModeToggle.textContent = enabled ? 'Exit focus mode' : 'Focus mode';
}

focusModeToggle.addEventListener('click', () => {
  setFocusMode(!document.body.classList.contains('focus-mode'));
});

document.addEventListener('keydown', (event) => {
  const typingInControl = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (event.key === 'Escape' && document.body.classList.contains('focus-mode') && !typingInControl) {
    setFocusMode(false);
  }
});

selectLab(getRequestedLab(), false);
