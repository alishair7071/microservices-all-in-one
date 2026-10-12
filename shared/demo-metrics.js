const { metrics } = require('@opentelemetry/api');

const meter = metrics.getMeter('trace-demo');

const requests = meter.createCounter('trace_demo.requests', {
  description: 'Completed trace demo requests'
});


const duration = meter.createHistogram('trace_demo.duration', {
  description: 'Trace demo request duration',
  unit: 's',
  // Request durations are recorded in seconds. These narrow buckets let p95
  // distinguish fast local requests instead of placing all of them in 0–5 s.
  advice: { explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] }
});


const mongodbErrors = meter.createCounter('trace_demo.mongodb.errors', {
  description: 'MongoDB failures during trace demo requests'
});


function recordDemoRequest(startedAt, statusCode) {
  const attributes = {
    route: '/trace-demo',
    outcome: statusCode >= 500 ? 'error' : 'success'
  };
  requests.add(1, attributes);
  duration.record(Number(process.hrtime.bigint() - startedAt) / 1e9, attributes);
}


function recordMongoError() {
  mongodbErrors.add(1, { route: '/trace-demo' });
}

module.exports = { recordDemoRequest, recordMongoError };
