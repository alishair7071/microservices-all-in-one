FROM node:20-alpine
WORKDIR /app
COPY resilience-target-service/package*.json ./
RUN npm ci --omit=dev
COPY shared/consul-registration.js ./consul-registration.js
COPY shared/correlated-logger.js ./correlated-logger.js
COPY shared/demo-metrics.js ./demo-metrics.js
COPY resilience-target-service/trace-demo.js .
COPY resilience-target-service/server.js .
ENV OTEL_SERVICE_NAME=resilience-target-service \
    OTEL_TRACES_EXPORTER=otlp \
    OTEL_METRICS_EXPORTER=otlp \
    OTEL_LOGS_EXPORTER=none \
    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
    OTEL_EXPORTER_OTLP_ENDPOINT=http://prometheus:9090/api/v1/otlp \
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://host.docker.internal:4318/v1/traces \
    OTEL_METRIC_EXPORT_INTERVAL=2000 \
    OTEL_NODE_ENABLED_INSTRUMENTATIONS=http,express,undici,mongodb,runtime-node
CMD ["npm", "start"]
