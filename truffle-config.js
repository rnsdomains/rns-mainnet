const config = require('./deployment-configuration.js');

module.exports = {
  networks: {
    'mainnet': {
      host: config.host,
      port: config.port,
      gas: config.gas,
      gasPrice: config.gasPrice,
      network_id: config.network_id,
      from: config.deployAccount
    },
    'dev': {
      host: "localhost",
      port: 8545,
      gas: 6000000,
      gasPrice: 0,
      network_id: "*" // Match any network id
    },
    'rsk': {
      host: "localhost",
      port: 4444,
      gas: 6300000,
      gasPrice: 0,
      network_id: "*" // Match any network id
    }
  }
};
