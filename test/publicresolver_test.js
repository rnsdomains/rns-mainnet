var assert = require('assert');

const RNS = artifacts.require('RNS');
const PublicResolver = artifacts.require('PublicResolver');

var utils = require('./utils.js');

contract('PublicResolver', function(accounts) {
	var resolver = null;
	var rns = null;

	beforeEach(async function() {
		rns = await RNS.new({ gas: 4700000 });
		resolver = await PublicResolver.new(rns.address, { gas: 4700000 });
		return rns.setSubnodeOwner(0, web3.sha3('eth'), accounts[0]);;
	});

	describe('fallback function', function() {
		it('forbids calls to the fallback function with 0 value', async function() {
			try {
				const tx = await web3.eth.sendTransaction({
						from: accounts[0],
						to: resolver.address,
						gas: 3000000
					});	
			} catch(ex) {
				assert.ok(utils.isVMException(ex));
			}
		});

		it('forbids calls to the fallback function with 1 value', async function() {
			try {
				const tx = await web3.eth.sendTransaction({
						from: accounts[0],
						to: resolver.address,
						gas: 3000000,
						value: 1
					});
			} catch(ex) {
				assert.ok(utils.isVMException(ex));
			}
		});
	});

	describe('has function', function() {
		it('returns false when checking nonexistent addresses', async function() {
			const result = await resolver.has(utils.node, "addr");
			assert.equal(result, false)
		});

		it('returns true for previously set address', async function() {
			await resolver.setAddr(utils.node, accounts[1], {from: accounts[0]});
			const has = await resolver.has(utils.node, "addr");
			assert.equal(has, true);
		});

		it('returns false when checking nonexistent hash', async function() {
			const result = await resolver.has(utils.node, "hash");
			assert.equal(result, false);
		});

		it('returns true for previously set content', async function() {
			await resolver.setContent(utils.node, accounts[1], {from: accounts[0]});
			const has = await resolver.has(utils.node, "hash");
			assert.equal(has, true)
		});

		it('returns false for address node checked as content', async function() {
			await resolver.setAddr(utils.node, accounts[1]);
			const has = await resolver.has(utils.node, "hash");
			assert.equal(has, false);
		});

		it('returns false for content node checked as address', async function() {
			await resolver.setContent(utils.node, accounts[1]);
			const has = await resolver.has(utils.node, "addr");
			assert.equal(has, false);
		});

		it('returns false for address node checked as unknown kind', async function() {
			await resolver.setAddr(utils.node, accounts[1]);
			const has = await resolver.has(utils.node, "not a kind");
			assert.equal(has, false);
		});

		it('returns false for content node checked as unknown kind', async function() {
			await resolver.setContent(utils.node, accounts[1]);
			const has = await resolver.has(utils.node, "not a kind");
			assert.equal(has, false);
		});
	});

	describe('supportsInterface function', async function() {
		it('supports both known interfaces', async function() {
			const result1 = await resolver.supportsInterface("0x3b3b57de");
			assert.equal(result1, true);
			const result2 = await resolver.supportsInterface("0xd8389dc5");
			assert.equal(result2, true);
		});

		it('does not support a random interface', async function() {
			const result = await resolver.supportsInterface("0x3b3b57df");
			assert.equal(result, false);
		});
	});
	
	describe('setAddr function', async function() {
		it('permits setting address by owner', async function() {
			await resolver.setAddr(utils.node, accounts[1]);
		});

		it('can overwrite previously set address', async function() {
			await resolver.setAddr(utils.node, accounts[1]);
			await resolver.setAddr(utils.node, accounts[0]);
		});

		it('can overwrite to same address', async function() {
			await resolver.setAddr(utils.node, accounts[1]);
			await resolver.setAddr(utils.node, accounts[1]);
		});

		it('forbids setting new address by non-owners', async function() {
			try {
				await resolver.setAddr(utils.node, accounts[1], {from: accounts[1]});
				assert.fail();
			}
			catch (ex) {
				assert.ok(utils.isVMException(ex));
			}
		});

		it('forbids writing same address by non-owners', async function() {
			await resolver.setAddr(utils.node, accounts[1], {from: accounts[0]});

			try {
				await resolver.setAddr(utils.node, accounts[1], {from: accounts[1]});
				assert.fail();
			}
			catch (ex) {
				assert.ok(utils.isVMException(ex));
			}
		});

		it('forbids overwriting existing address by non-owners', async function() {
			await resolver.setAddr(utils.node, accounts[1], {from: accounts[0]});
			try {
				await resolver.setAddr(utils.node, accounts[0], {from: accounts[1]});
				assert.fail();
			}
			catch (ex) {
				assert.ok(utils.isVMException(ex));
			}
		});
	});

	describe('addr function', function() {

		it('returns zero when fetching nonexistent addresses', async function() {
			const result = await resolver.addr(utils.node);
			assert.equal(result, "0x0000000000000000000000000000000000000000");
		});

		it('returns previously set address', async function() {
			await resolver.setAddr(utils.node, accounts[1]);
			const address = await resolver.addr(utils.node);
			assert.equal(address, accounts[1]);
		});

		it('returns overwritten address', async function() {
			await resolver.setAddr(utils.node, accounts[1]);
			await resolver.setAddr(utils.node, accounts[0]);
			const address = await resolver.addr(utils.node);
			assert.equal(address, accounts[0]);
		});

	});

	describe('setContent function', function() {

		it('permits setting content by owner', async function() {
			await resolver.setContent(utils.node, 'hash1');
		});

		it('can overwrite previously set content', async function() {
			await resolver.setContent(utils.node, 'hash1');
			await resolver.setContent(utils.node, 'hash2');
		});

		it('can overwrite to same content', async function() {
			await resolver.setContent(utils.node, 'hash1');
			await resolver.setContent(utils.node, 'hash1');
		});

		it('forbids setting content by non-owners', async function() {
			try {
				await resolver.setContent(utils.node, 'hash1', {from: accounts[1]});
				assert.fail();
			}
			catch (ex) {
				assert.ok(utils.isVMException(ex));
			}
		});

		it('forbids writing same content by non-owners', async function() {
			await resolver.setContent(utils.node, 'hash1', {from: accounts[0]});
			
			try {
				await resolver.setContent(utils.node, 'hash1', {from: accounts[1]});
				assert.fail();
			}
			catch (ex) {
				assert.ok(utils.isVMException(ex));
			}
		});

		it('forbids overwriting existing content by non-owners', async function() {
			await resolver.setContent(utils.node, 'hash1', {from: accounts[0]});
			
			try {
				await resolver.setContent(utils.node, 'hash2', {from: accounts[1]});
				assert.fail();
			}
			catch (ex) {
				assert.ok(utils.isVMException(ex));
			}
		});

	});

	describe('content function', function() {

		it('returns empty when fetching nonexistent content', async function() {
			const result = await resolver.content(utils.node);
			assert.equal(result, "0x0000000000000000000000000000000000000000000000000000000000000000");
		});

		it('returns previously set content', async function() {
			await resolver.setContent(utils.node, 'hash1');
			const content = await resolver.content(utils.node);
			assert.equal(web3.toUtf8(content), 'hash1');
		});

		it('returns overwritten content', async function() {
			await resolver.setContent(utils.node, 'hash1');
			await resolver.setContent(utils.node, 'hash2');
			const content = await resolver.content(utils.node);
			assert.equal(web3.toUtf8(content), 'hash2');
		});

	});

});
