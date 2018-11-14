var assert = require('assert');

const TestRegistrar = artifacts.require('TestRegistrar');
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

contract('TestRegistrar', function(accounts) {
    var registrar = null;
    var rns = null;

	beforeEach(async function() {
		rns = await RNS.new({ gas: 4700000 });
		registrar = await TestRegistrar.new(rns.address, 0);
		await rns.setOwner(0, registrar.address);
	});

    it('registers names', async function() {
		await registrar.register(web3.sha3('eth'), accounts[0]);
		
		const topaddress = await rns.owner(0);
		assert.equal(topaddress, registrar.address);
		
		const address = await rns.owner(utils.node);
		assert.equal(address, accounts[0]);
    });

    it('forbids transferring names within the test period', async function() {
        await registrar.register(web3.sha3('eth'), accounts[1]);
		
		try {
			await registrar.register(web3.sha3('eth'), accounts[0]);
			assert.fail();
		}
		catch (ex) {
			assert.ok(utils.isVMException(ex));
		}
    });

    it('allows claiming a name after the test period expires', async function() {
        await registrar.register(web3.sha3('eth'), accounts[1]);
        const owner = await rns.owner(utils.node);
        assert.equal(owner, accounts[1]);

        // Advance 28 days
		try {
			await promisify(cb => web3.currentProvider.sendAsync({
                jsonrpc: "2.0",
                "method": "evm_increaseTime",
                params: [28 * 24 * 60 * 60 + 1]}, cb));
		}
		catch (ex) {
			
		}

		console.log('increaseTime done');
		
		await registrar.register(web3.sha3('eth'), accounts[0]);
        const address = await rns.owner(utils.node);
		assert.equal(address, accounts[0]);
    });
});
