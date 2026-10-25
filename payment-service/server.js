const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const config = require('./config');
const paymentRoutes = require('./routes/payment-routes');
const { connectKafka } = require('./kafka/kafka-producer');
const { startService } = require('./consul-registration');
const idempotencyLabRoutes = require('./routes/idempotency-lab-routes');

const app = express();
app.use(cors());
app.use(express.json());
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'payment-service' }));
app.use(paymentRoutes);
app.use(idempotencyLabRoutes);

async function start() {
  await mongoose.connect(config.mongoUri);
  await startService(app, 'payment-service', config.port);
  console.log(`Payment service listening on port ${config.port}`);
  connectKafka();
}

start().catch((error) => { console.error(error); process.exit(1); });
