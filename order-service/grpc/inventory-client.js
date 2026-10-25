const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const { inventoryGrpcAddress } = require('../config');

const packageDefinition = protoLoader.loadSync(
  path.join(__dirname, '..', 'proto', 'inventory.proto'),
  { keepCase: true }
);
const inventoryGrpc = grpc.loadPackageDefinition(packageDefinition).inventory;
const inventoryClient = new inventoryGrpc.InventoryService(
  inventoryGrpcAddress,
  grpc.credentials.createInsecure()
);

function reduceStock(productId, quantity, reservationId) {
  return new Promise((resolve, reject) => {
    inventoryClient.ReduceStock(
      { product_id: productId, quantity, reservation_id: reservationId },
      (error, response) => error ? reject(error) : resolve(response)
    );
  });
}

function restoreStock(productId, quantity, reservationId) {
  return new Promise((resolve, reject) => {
    inventoryClient.RestoreStock(
      { product_id: productId, quantity, reservation_id: reservationId },
      (error, response) => error ? reject(error) : resolve(response)
    );
  });
}

module.exports = { reduceStock, restoreStock };

