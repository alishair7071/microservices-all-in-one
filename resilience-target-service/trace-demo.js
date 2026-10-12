const { MongoClient, MongoError } = require('mongodb');
const { logTraceEvent } = require('./correlated-logger');
const { recordDemoRequest, recordMongoError } = require('./demo-metrics');

const mongoClient = new MongoClient('mongodb://mongo:27017', { serverSelectionTimeoutMS: 3000 });

async function handleTraceDemo(request, response) {
  const startedAt = process.hrtime.bigint();
  let statusCode = 500;

  try {
    const failTarget = request.headers['x-demo-fail-target'] === '1';
    logTraceEvent('info', 'target.request.received', { failTarget });
    await mongoClient.connect();
    const collection = mongoClient.db('resilience_trace_db').collection('requests');
    let record;

    if (failTarget) {
      // MongoDB rejects this query, so its auto-instrumented operation records a real error.
      logTraceEvent('info', 'target.mongodb.query.started');
      await collection.findOne({ $invalidDemoOperator: true });
    } else {
      logTraceEvent('info', 'target.mongodb.insert.started');
      const inserted = await collection.insertOne({ createdAt: new Date() });
      const saved = await collection.findOne({ _id: inserted.insertedId });
      record = { id: saved._id.toString(), createdAt: saved.createdAt.toISOString() };
      logTraceEvent('info', 'target.mongodb.record.read', { recordId: record.id });
    }
    statusCode = 200;
    logTraceEvent('info', 'target.response.sent', { statusCode });
    response.writeHead(statusCode, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ record, error: null }));
  } catch (problem) {
    const error = problem instanceof Error ? problem.message : String(problem);
    const mongoFailure = problem instanceof MongoError;
    if (mongoFailure) recordMongoError();
    statusCode = mongoFailure ? 503 : 500;
    logTraceEvent('error', mongoFailure ? 'target.mongodb.failed' : 'target.request.failed', { error });
    logTraceEvent('error', 'target.response.sent', { statusCode });
    if (!response.headersSent) {
      response.writeHead(statusCode, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ record: null, error }));
    } else {
      response.destroy();
    }
  } finally {
    recordDemoRequest(startedAt, statusCode);
  }
}

module.exports = { handleTraceDemo };
