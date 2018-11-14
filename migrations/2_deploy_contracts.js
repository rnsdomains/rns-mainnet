const namehash = require('eth-ens-namehash');
const config = require('../deployment-configuration.js');

const ERC677 = artifacts.require("./ERC677TokenContract.sol")
const RNS = artifacts.require("./RNS.sol");
const Registrar = artifacts.require('./TokenRegistrar.sol');
const PublicResolver = artifacts.require('./PublicResolver.sol');
const SafeMath = artifacts.require('../third-party/openzeppelin/math/SafeMath.sol');

function getRootNodeFromTLD(tld) {
  return {
    namehash: namehash.hash(tld),
    sha3: web3.sha3(tld)
  };
}

const TLD = 'rsk';

function deployDev(deployer, network, accounts) {
  const rootNode = getRootNodeFromTLD(TLD);

  const OWNER = accounts[0];
  const TOTAL_SUPPLY = 1e27;

  const opts = { gas: 6000000, gasPrice: 1000000, from: OWNER };

  return deployer.deploy(ERC677, OWNER, TOTAL_SUPPLY, opts)
    .then(() => {
      return deployer.deploy(RNS, opts);
    })
    .then(() => {
      return deployer.deploy(PublicResolver, RNS.address, opts);
    })
    .then(() => {
      return RNS.at(RNS.address).setDefaultResolver(PublicResolver.address, opts);
    })
    .then(() => {
      return deployer.deploy(SafeMath);
    })
    .then(() => {
      return deployer.link(SafeMath, Registrar);
    })
    .then(() => {
      return deployer.deploy(Registrar, RNS.address, rootNode.namehash, ERC677.address, opts);
    })
    .then(() => {
      return RNS.at(RNS.address).setSubnodeOwner('0x0', rootNode.sha3, Registrar.address, opts);
    });
}

function deploy(deployer, network, accounts) {
  const RIF_TOKEN_ADDRESS = config.rifTokenAddress;
  const RNS_OWNER = config.rnsOwner;
  
  const rootNode = getRootNodeFromTLD(TLD);

  return deployer.deploy(RNS)
    .then(() => {
      return deployer.deploy(PublicResolver, RNS.address);
    })
    .then(() => {
      return RNS.at(RNS.address).setDefaultResolver(PublicResolver.address);
    })
    .then(() => {
      return deployer.deploy(SafeMath);
    })
    .then(() => {
      return deployer.link(SafeMath, Registrar);
    })
    .then(() => {
      return deployer.deploy(Registrar, RNS.address, rootNode.namehash, RIF_TOKEN_ADDRESS);
    })
    .then(() => {
      return RNS.at(RNS.address).setSubnodeOwner('0x0', rootNode.sha3, Registrar.address);
    })
    .then(() => {
      return RNS.at(RNS.address).setOwner('0x0', RNS_OWNER);
    });
}

module.exports = function(deployer, network, accounts) {
  if (network == 'mainnet' || network == 'testnet') {
    return deploy(deployer, network, accounts);
  } else {
    return deployDev(deployer, network, accounts);
  }
};