const namehash = require('eth-ens-namehash');
const config = require('../deployment-configuration.js');

const ERC677 = artifacts.require("./ERC677TokenContract.sol")
const RNS = artifacts.require("./RNS.sol");
const Registrar = artifacts.require('./FixedFeeFIFSRegistrar.sol');
const PublicResolver = artifacts.require('./PublicResolver.sol');
const SafeMath = artifacts.require('../third-party/openzeppelin/math/SafeMath.sol');

function getRootNodeFromTLD(tld) {
  return {
    namehash: namehash.hash(tld),
    sha3: web3.sha3(tld)
  };
}

const TLD = 'btc';

function deployDev(deployer, network, accounts) {
  const rootNode = getRootNodeFromTLD(TLD);

  const OWNER = accounts[0];
  // const OWNER = '0xc580145e32e7d904d7de449c37dad9ca9d39f61f';
  const TOTAL_SUPPLY = 1e27;
  const TOKEN_VAL = 1e18;
  const RESOURCE_POOL = "0x12345678"

  const opts = { /*gas: 6000000, gasPrice: 1000000,*/ from: OWNER };

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
      return deployer.deploy(Registrar, RNS.address, rootNode.namehash, TOKEN_VAL, TOKEN_VAL, ERC677.address, RESOURCE_POOL, opts);
    })
    .then(() => {
      return RNS.at(RNS.address).setSubnodeOwner('0x0', rootNode.sha3, Registrar.address, opts);
    });
}

module.exports = function(deployer, network, accounts) {
  return deployDev(deployer, network, accounts);
};