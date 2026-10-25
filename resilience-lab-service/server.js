const express = require('express');
const { startService } = require('./consul-registration');

const app = express();

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'resilience-lab-service' }));
app.use('/circuit-breaker', require('./labs/circuit-breaker'));
app.use('/retry', require('./labs/retry'));
app.use('/bulkhead', require('./labs/bulkhead'));
app.use('/load-shedding', require('./labs/load-shedding'));
app.use('/trace-demo', require('./labs/trace-demo'));

startService(app, 'resilience-lab-service', 4020)
  .then(() => console.log('Resilience Lab Service listening on port 4020'))
  .catch((error) => { console.error(error); process.exit(1); });
