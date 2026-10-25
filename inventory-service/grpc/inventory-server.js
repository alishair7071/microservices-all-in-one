const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const { grpcPort } = require('../config');
const { reduceStock, restoreStock } = require('../services/stock-service');

const packageDefinition = protoLoader.loadSync(
  path.join(__dirname, '..', 'proto', 'inventory.proto'),
  { keepCase: true }
);
const inventoryGrpc = grpc.loadPackageDefinition(packageDefinition).inventory;

function reduceStockGrpc(call, callback) {
  reduceStock(call.request.product_id, call.request.quantity, call.request.reservation_id)
    .then((result) => callback(null, result));
}

function restoreStockGrpc(call, callback) {
  restoreStock(call.request.product_id, call.request.quantity, call.request.reservation_id)
    .then((result) => callback(null, result));
}

function startGrpcServer() {
  const grpcServer = new grpc.Server();
  grpcServer.addService(inventoryGrpc.InventoryService.service, {
    ReduceStock: reduceStockGrpc,
    RestoreStock: restoreStockGrpc
  });

  grpcServer.bindAsync(
    `0.0.0.0:${grpcPort}`,
    grpc.ServerCredentials.createInsecure(),
    (error, port) => {
      if (error) throw error;
      grpcServer.start();
      console.log(`Inventory gRPC server listening on ${port}`);
    }
  );
}

module.exports = { startGrpcServer };

