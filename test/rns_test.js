var assert = require('assert');

const RNS = artifacts.require('RNS');

var utils = require('./utils.js');

// from https://ethereum.stackexchange.com/questions/11444/web3-js-with-promisified-api

const promisify = (inner) =>
  new Promise((resolve, reject) =>
    inner((err, res) => {
      if (err) { reject(err) }

      resolve(res);
    })
);
  
async function getEventsForTx(event, txid) {
	const tx = await web3.eth.getTransaction(txid.tx);
	return promisify(cb => event({}, {fromBlock: tx.blockNumber, toBlock: tx.blockNumber}).get(cb));
}

contract('RNS', function (accounts) {
	var rns = null;
	var txids = [];

	beforeEach(async function() {
		rns = await RNS.new({ gas: 4700000 });
	});

	after(async function() {
		var gas = 0;
		
		for (var n in txids) {
			const txid = txids[n];
			const tr = txid.receipt;

			gas += tr.gasUsed - 21000;
		}

		console.log("Gas report for RNS.sol: " + gas);
	});

	it("transfers ownership", async function() {
		const txid = await rns.setOwner(0, "0x1234", {from: accounts[0]});
		txids.push(txid);
		const owner = await	rns.owner(0);
		assert.equal(owner, "0x0000000000000000000000000000000000001234");
		const logs = await getEventsForTx(rns.Transfer, txid);
		assert.equal(logs.length, 1);
		var args = logs[0].args;
		assert.equal(args.node, "0x0000000000000000000000000000000000000000000000000000000000000000");
		assert.equal(args.ownerAddress, "0x0000000000000000000000000000000000001234");
	});

	it("prohibits transfers by non-owners", async function() {
		try {
			await rns.setOwner(1, "0x1234", {from: accounts[0]});
			assert.fail();
		}
		catch (ex) {
			assert.ok(utils.isVMException(ex));
		}
		
		const owner = await rns.owner(1);
		assert.equal(owner, "0x0000000000000000000000000000000000000000");
	});

	it("sets resolvers", async function() {
		const txid = await rns.setResolver(0, "0x1234", {from: accounts[0]});
		txids.push(txid);
		const resolver = await rns.resolver(0);
		assert.equal(resolver, "0x0000000000000000000000000000000000001234");
		const logs = await getEventsForTx(rns.NewResolver, txid);
		assert.equal(logs.length, 1);
		var args = logs[0].args;
		assert.equal(args.node, "0x0000000000000000000000000000000000000000000000000000000000000000");
		assert.equal(args.resolverAddress, "0x0000000000000000000000000000000000001234");
	});

	it("prohibits setting resolver by non-owners", async function() {
		try {
			await rns.setResolver(1, "0x1234", {from: accounts[0]});
			assert.fail();
		}
		catch (ex) {
			assert.ok(utils.isVMException(ex));
		}
		
		const resolver = await rns.resolver(1);
		assert.equal(resolver, "0x0000000000000000000000000000000000000000");
	});

	it("permits setting TTL", async function() {
		const txid = await rns.setTTL(0, 3600, {from: accounts[0]});
		txids.push(txid);
		const ttl = await rns.ttl(0);
		assert.equal(ttl.toNumber(), 3600);
		const logs = await getEventsForTx(rns.NewTTL, txid);
		assert.equal(logs.length, 1);
		var args = logs[0].args;
		assert.equal(args.node, "0x0000000000000000000000000000000000000000000000000000000000000000");
		assert.equal(args.ttlValue.toNumber(), 3600);
	});

	it("prohibits setting TTL by non-owners", async function() {
		try {
			await rns.setTTL(1, 3600, {from: accounts[0]});
			assert.fail();
		}
		catch (ex) {
			assert.ok(utils.isVMException(ex));
		}
		
		const ttl = await rns.ttl(1);
		assert.equal(ttl.toNumber(), 0);
	});

	it("creates subnodes", async function() {
		const txid = await rns.setSubnodeOwner(0, web3.sha3('eth'), accounts[1], {from: accounts[0]});
		txids.push(txid);
		const owner = await rns.owner(utils.node);
		assert.equal(owner, accounts[1]);
		var logs = await getEventsForTx(rns.NewOwner, txid);
		assert.equal(logs.length, 1);
		var args = logs[0].args;
		assert.equal(args.node, "0x0000000000000000000000000000000000000000000000000000000000000000");
		assert.equal(args.label, web3.sha3('eth'));
		assert.equal(args.ownerAddress, accounts[1]);
	});

	it("prohibits subnode creation by non-owners", async function() {
		try {
			await rns.setSubnodeOwner(0, web3.sha3('eth'), accounts[1], {from: accounts[1]});
			assert.fail();
		}
		catch (ex) {
			assert.ok(utils.isVMException(ex));
		}

		const owner = await rns.owner(utils.node);

		assert.equal(owner, "0x0000000000000000000000000000000000000000");
	});
});

