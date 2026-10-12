const { MongoClient, MongoError } = require('mongodb');
const { writeManualLog } = require('./correlated-logger');
const { recordDemoRequest, recordMongoError } = require('./demo-metrics');

const mongoClient = new MongoClient('mongodb://mongo:27017', { serverSelectionTimeoutMS: 3000 });

async function handleTraceDemo(request, response) {
  const startedAt = process.hrtime.bigint();
  let statusCode = 500;

  try {
    const failTarget = request.headers['x-demo-fail-target'] === '1';
    writeManualLog('info', 'Target Service received the trace-demo request from Lab Service.', { failTarget });
    await mongoClient.connect();
    const collection = mongoClient.db('resilience_trace_db').collection('requests');
    let record;

    if (failTarget) {
      // MongoDB rejects this query, so its auto-instrumented operation records a real error.
      writeManualLog('info', 'Target Service is sending the deliberate invalid query to MongoDB.');
      await collection.findOne({ $invalidDemoOperator: true });
    } else {
      writeManualLog('info', 'Target Service is saving a request record in MongoDB.');
      const inserted = await collection.insertOne({ createdAt: new Date() });
      const saved = await collection.findOne({ _id: inserted.insertedId });
      record = { id: saved._id.toString(), createdAt: saved.createdAt.toISOString() };
      writeManualLog('info', 'Target Service read the saved request record from MongoDB.', { recordId: record.id });
    }
    statusCode = 200;
    writeManualLog('info', 'Target Service sent a successful response to Lab Service.', { statusCode });
    response.writeHead(statusCode, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ record, error: null }));
  } catch (problem) {
    const error = problem instanceof Error ? problem.message : String(problem);
    const mongoFailure = problem instanceof MongoError;
    if (mongoFailure) recordMongoError();
    statusCode = mongoFailure ? 503 : 500;
    writeManualLog('error', mongoFailure
      ? 'MongoDB could not complete the Target Service operation.'
      : 'Target Service could not complete the trace-demo request.', { error });
    writeManualLog('error', 'Target Service sent a failed response to Lab Service.', { statusCode });
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
