# RIF Name Service

Implementation for Registry, Registrar, Deed and Resolver for the RIF Name Service

For more information see the [documentation](https://docs.rns.rifos.org).

## Mainnet deployment information

- **Address**: [`0xcb868aeabd31e2b66f74e9a55cf064abb31a4ad5`](http://explorer.rsk.co/address/0xcb868aeabd31e2b66f74e9a55cf064abb31a4ad5)
- **ABI**: [RNSABI.json](/Architecture/RNSABI.json)

Details of the [registrar](http://docs.rns.rifos.org/Architecture/Registry/) in the [documentation site](https://docs.rns.rifos.org).

## Testnet deployment information

See [RNS Testnet documentation section](http://docs.rns.rifos.org/RNS-Testnet/) for testing environment variants and information.

## Install Truffle

```
sudo npm install -g truffle
npm install
```

For details see [Truffle Docs](https://truffleframework.com/)

## Install Package

If Truffle is already installed run:

```
npm install
```

## Deploy

Deploy to local ganache-cli:

```
truffle deploy --network dev
```

Deploy to local RSK node

```
truffle deploy --network rsk
```

## Test

Test on local ganache-cli:

```
truffle test --network dev
```

Test on local RSK node:

```
truffle test --network rsk
```

## Contracts

### RNS.sol

Implementation of the Registry contract, it provides a simple mapping between a domain and its Resolver. Everything related to a domain ownership is managed in this contract, including ownership transfer and sub-domain creation.

### TokenRegistrar.sol

Implementation of the Registrar, it handles the auction process for each subnode of the node it owns.

### TokenDeed.sol

Implementation of the Deed, it holds RIF tokens in exchange for ownership of a node.

### PublicResolver.sol

Implementation of a simple resolver anyone can use; only allows the owner of a node to set its address.

 
## Documentation

For more information see [RNS Docs](https://docs.rns.rsk.co)

# Contributors

- [@m-picco](https://github.com/m-picco)
- [@ajlopez](https://github.com/ajlopez)
- [@julianlen](https://github.com/julianlen)
- [@ilanolkies](https://github.com/ilanolkies)
- [@alebanzas](https://github.com/alebanzas)
