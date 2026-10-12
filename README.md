# Microservices Demo

A small project for learning how services communicate. Run it with:

```bash
docker compose up --build
```

Open the frontend at `http://localhost:3000`. Browser requests go through Kong at `http://localhost:8000/api`.

## Services and request flow

| Service | What it does |
| --- | --- |
| Inventory | Stores products in MongoDB; exposes REST and a gRPC stock operation. |
| Order | Creates orders, calls Inventory and Payment, and publishes an `OrderCreated` RabbitMQ event. |
| Payment | Saves payments and publishes a `PaymentApproved` Kafka event. |
| Email A/B | Consume RabbitMQ and Kafka messages. |
| Notification | Consumes RabbitMQ and Kafka messages. |
| Resilience Lab | Runs the circuit breaker, timeout, retry, and bulkhead examples. |
| Resilience Target | Provides simple responses for the labs to call. |
| Account | Demonstrates event sourcing by rebuilding account balances from an immutable event history. |
| Kong | Routes frontend requests to the services; also demonstrates load balancing and rate limiting. |

The main order flow is:

```text
Frontend -> Kong -> Order -> Inventory (product REST lookup, then gRPC stock reduction)
                         -> MongoDB (save order)
                         -> RabbitMQ (OrderCreated event)

Frontend -> Kong -> Order -> Payment -> MongoDB (save payment)
                                    -> Kafka (PaymentApproved event)
```

## Where to look in the code

- `*/server.js` starts each HTTP service.
- `*/routes/` contains the HTTP paths and their handlers. Express combines the path in `app.use('/orders', orderRoutes)` with a route's `router.post('/')` to make `POST /orders`.
- `*/models/` contains MongoDB schemas.
- `*/grpc/`, `*/messaging/`, and `*/kafka/` contain the corresponding communication code.
- `resilience-lab-service/labs/circuit-breaker.js` contains the Opossum breaker and its route.
- `resilience-lab-service/labs/retry.js` contains the retry loop and its route.
- `resilience-lab-service/labs/bulkhead.js` limits how many lab requests can call the target at the same time.
- `proto/inventory.proto` defines Inventory's stock reservation and restoration gRPC operations.
- `resilience-target-service/server.js` returns the simulated normal, slow, or temporary failure responses.
- `account-service/events/` stores and replays the account event history for the Event Sourcing Lab.
- `kong/kong.yml` maps public `/api/...` paths to service paths.
- `frontend/public/app.js` sends browser requests to Kong and renders the results.

## Circuit breaker and timeout lab

The frontend has one **Send Protected Request** button. The request travels through Kong and the Resilience Lab Service to the Resilience Target Service.

- **Normal response:** returns JSON immediately.
- **Slow response:** waits 5 seconds; the Resilience Lab Service breaker times out after 3 seconds.
- **Unavailable service:** run `docker compose stop resilience-target-service`, then click the button repeatedly. After three failures, the circuit opens and rejects requests immediately. Run `docker compose start resilience-target-service`, wait 15 seconds, and click again to test recovery.

The breaker lives in the Resilience Lab Service.

## Saga lab

Order creation reserves stock through Inventory, then saves the order in Order Service. Select **Simulate order-save failure after stock is reserved (Saga demo)** in the order form to fail between those steps. Order Service then calls Inventory to restore the stock. The order is not created, and the frontend refreshes the product stock. The Saga coordinator is `order-service/routes/order-routes.js`; the compensation is implemented by Inventory's `RestoreStock` gRPC operation. RabbitMQ publishing keeps its existing behavior and happens after the database steps succeed.

## Bulkhead lab

Click **Send 5 Concurrent Requests**. The Resilience Lab Service permits two requests at a time to call the Resilience Target Service, which takes five seconds to respond. The other three requests are rejected immediately with HTTP 503. The limit is in `resilience-lab-service/labs/bulkhead.js`.

## Event Sourcing lab

Open a demo account, then deposit or withdraw money. Each accepted command appends an immutable event to the `account_events` collection in the `account_db` database. The displayed balance is rebuilt by replaying those events; the lab also shows the ordered event history. Amounts are stored as integer cents. This is simulated money and is separate from the Payment Service.

## Retry lab

Click **Send Retry Request** once in the frontend. The Resilience Lab Service makes a safe GET request to the Resilience Target Service. The target returns `503` for attempts 1 and 2, then `200` for attempt 3. The lab waits `200–300 ms` and `400–500 ms` between attempts (exponential backoff plus jitter). The frontend shows every attempt, wait, and the final result. The retry logic is in `resilience-lab-service/labs/retry.js`.

## OpenTelemetry tracing lab

Click **Send Traced Request** to make a request through the Lab Service, Target Service, and MongoDB. Both Node services preload `@opentelemetry/auto-instrumentations-node/register` from their `npm start` scripts. Environment variables in their Dockerfiles set the service names and OTLP endpoint. The package automatically creates spans for HTTP, Express, Undici `fetch`, and MongoDB; the route handlers do not create spans. In Jaeger, search for service `resilience-lab-service` and operation `POST /trace-demo` to exclude health-check traces. Automatic instrumentation does not add a trace ID to the browser response. Jaeger runs separately from this Compose stack at `localhost:16686`, and the services export to `host.docker.internal:4318` by default.

Select **Simulate a failure in Target Service before the MongoDB insert** to make MongoDB reject an invalid query. The Target responds with HTTP 503 and the Lab responds with HTTP 502. Automatic instrumentation may mark the failed MongoDB operation and the HTTP 5xx spans as errors. The failure does not insert a MongoDB record.

The tracing lab also writes structured request logs. Run `docker compose logs resilience-lab-service resilience-target-service` to see JSON lines with the same `traceId` across both services. In Jaeger, open a `/trace-demo` trace and expand its Lab and Target spans to see the matching messages under **Events** (called **Logs** in some Jaeger versions). These are span events attached to the trace; Jaeger is not the central store for the container logs.

## OpenTelemetry metrics lab

The same Lab and Target services export OpenTelemetry metrics to Prometheus every 2 seconds. Prometheus receives them through its OTLP HTTP endpoint, while traces continue to Jaeger. Open the [Trace Demo Metrics dashboard](http://localhost:3001/d/trace-demo-metrics/trace-demo-metrics) in Grafana (initial local login: `admin` / `admin`), or query Prometheus at <http://localhost:9090>. The learning dashboard starts with four panels: completed requests, failed requests, p95 duration, and request rate.

The custom request counter and duration histogram are recorded only for `POST /trace-demo`, so Docker's `/health` checks do not appear in these panels. Send normal and failed requests from the frontend, then wait for the next metrics export. The `job` label distinguishes Lab from Target. The **Failed requests** panel counts all responses with status 500 or above, including unexpected application errors. The p95 panel uses the last minute of duration data. Prometheus stores trends across requests; Jaeger remains the place to inspect a single request trace.

To practice with an unexpected JavaScript error, temporarily change `mongoClient.connect()` to `mongoClient.connectx()` inside `resilience-target-service/trace-demo.js`. Rebuild and start the service with `docker compose up -d --build --no-deps resilience-target-service`, then send a normal traced request. Target returns 500 and Lab returns 502; both services' failed-request counters increase, while the MongoDB error counter does not. Restore the original method name and rebuild the service afterward. A syntax error or a broken import that prevents a service from starting cannot be recorded by that service's in-process metrics; inspect `docker compose logs resilience-target-service` for those failures.
