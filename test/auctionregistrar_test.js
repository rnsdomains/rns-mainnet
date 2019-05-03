
var assert = require('assert');
var utils = require('./utils');

const ERC677TokenContract = artifacts.require("./ERC677TokenContract.sol")
const RNS = artifacts.require('RNS');
const TokenRegistrar = artifacts.require('TokenRegistrar');
const TokenDeed = artifacts.require('TokenDeed');
const PublicResolver = artifacts.require('PublicResolver');

const contexts = require('./ERCContexts/ERCContexts');

for (const key in contexts) {
    const contextDescription = contexts[key].description,
          Context = contexts[key].constructor;

    contract(`${contextDescription} TokenRegistrar`, function(accounts) {
        const RENT_VALUE = utils.toTokens(1); // could change over time
        const INITIAL_BID_FEE = RENT_VALUE;
        const MIN_TOKEN_QUANTITY = utils.toTokens(1);
        const RESOURCE_POOL_ADDRESS = '0xe594df49aa7a13ccdd2db3a7917312e02374f744';

        const TOTAL_SUPPLY = 1e27;
        const TLD = 'rsk';

        var registrar = null;
        var rns = null;
        var publicResolver = null;

        let context = null;

        var dotRsk = web3.sha3('0000000000000000000000000000000000000000000000000000000000000000' + web3.sha3(TLD).slice(2), {encoding: 'hex'});
        var nameDotRsk = web3.sha3(dotRsk + web3.sha3('name').slice(2), {encoding: 'hex'});

        beforeEach(async function() {
            await utils.resetNode();
            
            tokenContract = await ERC677TokenContract.new(accounts[0], TOTAL_SUPPLY, { from: accounts[0] });

            rns = await RNS.new();

            publicResolver = await PublicResolver.new(rns.address, { from: accounts[0] });
            await rns.setDefaultResolver(publicResolver.address, { from: accounts[0] });

            registrar = await TokenRegistrar.new(rns.address, dotRsk, tokenContract.address);
            await rns.setSubnodeOwner(0, web3.sha3(TLD), registrar.address);
            
            context = new Context(tokenContract, registrar, accounts);
        });

        it('starts auctions', async function() {
            await registrar.startAuction(web3.sha3('name'));

            var result = await registrar.entries(web3.sha3('name'));
            
            assert.equal(result[0], 1); // status == Auction	
            assert.equal(result[1], 0); // deed == 0x00

            // Advance 2 days
            await utils.increaseTime(utils.days(2));
            
            await registrar.startAuction(web3.sha3('name'));

            var result = await registrar.entries(web3.sha3('name'));
            
            assert.equal(result[0], 1); // status == Auction
            assert.equal(result[1], 0); // deed == 0x00
            // Expected to end 5 days from start
            var expectedEnd = new Date().getTime() / 1000 + utils.days(5);
            
            assert.ok(Math.abs(result[2].toNumber() - expectedEnd) < 5); // registrationDate
            assert.equal(result[3], 0); // value = 0
            assert.equal(result[4], 0); // highestBid = 0

            // Advance 30 days
            await utils.increaseTime(utils.days(30));

            // Advancing days only have an effect after a transaction
            await registrar.startAuction(web3.sha3('anothername'));

            // Check later auctions end 5 days after they start
            var result = await registrar.entries(web3.sha3('anothername'));
            
            // Expected to end 128 days from start (91 + 2 + 30 + 5)
            var expectedEnd = new Date().getTime() / 1000 + utils.days(37);
            assert.ok(Math.abs(result[2].toNumber() - expectedEnd) < 5); // registrationDate
        });

        it('no scheduled availability', async function() {
            
            await registrar.startAuction(web3.sha3('freedomhacker'));
            await registrar.startAuction(web3.sha3('unicorn'));
            
            result = await registrar.entries(web3.sha3('freedomhacker'));
            assert.equal(result[0], 1);

            result = await registrar.entries(web3.sha3('unicorn'));
            assert.equal(result[0], 1);		
        });

        it('records bids', async function() {
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            await registrar.startAuction(web3.sha3('name'));
            
            // Submit a bid
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), accounts[0], utils.toTokens(1), 0);
            
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Check a duplicate bid would throw
            try {
                await context.newBid(bid.sealedBid, bid.deposit, bid.account);
                assert.fail();
            }
            catch (ex) { }
            
            // Check it was recorded correctly
            const deedAddress = await registrar.sealedBids(bid.account, bid.sealedBid);
            const deed = TokenDeed.at(deedAddress);
            const balance = await deed.tokenQuantity();
            assert.equal(balance.toNumber(), bid.deposit);

            // Submit a less-than-minimum bid and check it throws
            try {
                await context.newBid(bid.sealedBid, bid.deposit, bid.account);
                assert.fail();
            }
            catch (ex) {
                
            }
        });

        it("has 0 balance after recording new bid", async() => {
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // check the registrar doesn't have any tokens left (all transfered to the deed)
            const registrarBalance = await tokenContract.balanceOf(registrar.address);
            assert.equal(registrarBalance, 0);
        });

        it('concludes auctions', async function() {
            // Send tokens to auxiliary accounts
            for (var k = 1; k <= 5; k++)
                await tokenContract.transfer(accounts[k], utils.toTokens(2.5));

            var bidData = [
                // A regular bid
                {description: 'A regular bid', account: accounts[0], value: utils.toTokens(1.1), deposit: utils.toTokens(2), salt: 1, expectedFee: 0 },
                // A better bid
                {description: 'Winning bid', account: accounts[1], value: utils.toTokens(2), deposit: utils.toTokens(2), salt: 2, expectedFee: 0.75 },
                // Lower, but affects second place
                {description: 'Losing bid that affects price', account: accounts[2], value: utils.toTokens(1.5), deposit: utils.toTokens(2), salt: 3, expectedFee: 0 },
                // No effect
                {description: 'Losing bid that doesn\'t affect price', account: accounts[3], value: utils.toTokens(1.2), deposit: utils.toTokens(2), salt: 4, expectedFee: 0 },
                // Deposit smaller than value
                {description: 'Bid with deposit less than claimed value', account: accounts[4], value: utils.toTokens(5), deposit: utils.toTokens(0.1), salt: 5, expectedFee: 0 }
            ];

            for (var nb = 0; nb < bidData.length; nb++) {
                var bid = bidData[nb];
                var tokenBalance = await tokenContract.balanceOf(bid.account);
                bid.startingBalance = tokenBalance.toFixed();
            }
            
            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            var result = await registrar.entries(web3.sha3('name'));
            // Should be status 1 (Auction)
            assert.equal(result[0], 1);
            
            for (var nb = 0; nb < bidData.length; nb++) {
                var bid = bidData[nb];
                var tokenBalance = await tokenContract.balanceOf(bid.account);
                bid.startingBalance = tokenBalance.toFixed();
                var result = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
                bid.sealedBid = result;

                await context.newBid(bid.sealedBid, bid.deposit, bid.account);
            }

            // Try to reveal a bid early
            try {
                await registrar.unsealBid(web3.sha3('name'), bidData[0].value, bidData[0].salt, {from: bidData[0].account});
                assert.fail();
            }
            catch (ex) {
                
            }

            // Advance 3 days to the reveal period
            await utils.increaseTime(utils.days(3) + 60);
            
            // Start an auction for 'anothername' to force time update
            await registrar.startAuction(web3.sha3('anothername'));
            
            // checks status
            var result = registrar.entries(web3.sha3('name'));
                
            // Reveal all the bids
            for (var nb = 0; nb < bidData.length; nb++) {
                var bid = bidData[nb];
                await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, {from: bid.account});
            }
            
            // Advance another two days to the end of the auction
            await utils.increaseTime(utils.days(2));
            
            // Finalize the auction
            await registrar.finalizeAuction(web3.sha3('name'), {from: accounts[1]});

            var result = await registrar.entries(web3.sha3('name'));
            assert.equal(result[0], 2); // status == Owned
            assert.equal(result[3], utils.toTokens(1.5)); // value = 150 tokens
            assert.equal(result[4], utils.toTokens(2)); // highestBid = 200 tokens
            var deed = TokenDeed.at(result[1]);
            var addr = await deed.owner();
            assert.equal(addr, accounts[1]);

            // Check the registrar is correct
            var addr = await deed.registrar();
            assert.equal(addr, registrar.address);

            // Check the balance in tokens is correct
            var balance = await tokenContract.balanceOf(result[1]);
            assert.equal(balance.toNumber(), bidData[2].value - RENT_VALUE);

            // Check the token quantity is correct
            var tokenQuantity = await deed.tokenQuantity();
            assert.equal(tokenQuantity, bidData[2].value - RENT_VALUE);

            // Check balances
            for (var nb = 0; nb < bidData.length; nb++) {
                var bid = bidData[nb];
                
                var tokenBalance = await tokenContract.balanceOf(bid.account);
                var spentFee = Math.floor(10000*(bid.startingBalance - tokenBalance.toFixed()) / Math.min(bid.value, bid.deposit))/10000;
                console.log('\t Bidder #' + bid.salt, bid.description + '. Spent:', 100 * spentFee + '%; Expected:', 100 * bid.expectedFee + '%;');
                assert.equal(spentFee, bid.expectedFee);
            }

            // Check the owner is set in RNS
            const owner = await rns.owner(nameDotRsk);
            assert.equal(owner, accounts[1]);
        });
        
        it("concludes an auction of only one participant", async() => {
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0};

            const originalAccountBalance = await tokenContract.balanceOf(bid.account);

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // conclude the auction
            await utils.increaseTime(utils.days(3) + 1);
            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });
            await utils.increaseTime(utils.days(2));
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            const newAccountBalance = await tokenContract.balanceOf(bid.account);

            const entry = await registrar.entries(web3.sha3('name'));
            const deedBalance = await tokenContract.balanceOf(entry[1]);

            // check the deed has the expected amount (min quantity since it's only one participant)
            // and that the account balance is the original minus the consumed value
            assert.equal(entry[3].toNumber(), MIN_TOKEN_QUANTITY);
            assert.equal(deedBalance.toNumber(), MIN_TOKEN_QUANTITY - INITIAL_BID_FEE);
            assert.ok(newAccountBalance.plus(MIN_TOKEN_QUANTITY).eq(originalAccountBalance)); // use BigNumber.js methods to handle big numbers
        });

        it("concludes an auction of only two participants", async() => {
            await tokenContract.transfer(accounts[1], utils.toTokens(2.5), { from: accounts[0] });

            const loserBid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0};
            const winnerBid = {account: accounts[1], value: utils.toTokens(1.2), deposit: utils.toTokens(1.2), salt: 1};

            const originalAccountBalance = await tokenContract.balanceOf(winnerBid.account);

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            
            loserBid.sealedBid = await registrar.shaBid(web3.sha3('name'), loserBid.account, loserBid.value, loserBid.salt);
            winnerBid.sealedBid = await registrar.shaBid(web3.sha3('name'), winnerBid.account, winnerBid.value, winnerBid.salt);
            
            await context.newBid(loserBid.sealedBid, loserBid.deposit, loserBid.account);
            await context.newBid(winnerBid.sealedBid, winnerBid.deposit, winnerBid.account);

            // conclude the auction
            await utils.increaseTime(utils.days(3) + 1);
            await registrar.unsealBid(web3.sha3('name'), loserBid.value, loserBid.salt, { from: loserBid.account });
            await registrar.unsealBid(web3.sha3('name'), winnerBid.value, winnerBid.salt, { from: winnerBid.account });
            await utils.increaseTime(utils.days(2));
            await registrar.finalizeAuction(web3.sha3('name'), { from: winnerBid.account });

            const newAccountBalance = await tokenContract.balanceOf(winnerBid.account);

            const entry = await registrar.entries(web3.sha3('name'));
            const deedBalance = await tokenContract.balanceOf(entry[1]);

            // check the deed has the expected amount (loser's bidded value)
            // and that the account balance is the original minus the consumed value
            assert.equal(entry[3].toNumber(), loserBid.value);
            assert.equal(deedBalance.toNumber(), loserBid.value - RENT_VALUE);
            assert.ok(newAccountBalance.plus(loserBid.value).eq(originalAccountBalance)); // use BigNumber.js library to handle big numbers
        });

        it("releases deed before the rent payment period", async function() {
            // Send tokens to auxiliary accounts
            await tokenContract.transfer(accounts[1], utils.toTokens(5), {from:accounts[0]});

            var sealedBid = null;
            var winnerBalance = 0;

            var owner = accounts[1];
            var ownerValue = utils.toTokens(3);
            
            var notOwner = accounts[0];
            var notOwnerValue = utils.toTokens(2);

            await registrar.startAuction(web3.sha3('name'), { from: owner });
            var result = await registrar.shaBid(web3.sha3('name'), notOwner, notOwnerValue, 1);
            sealedBid = result;

            await context.newBid(sealedBid, notOwnerValue, notOwner);

            var result = await registrar.shaBid(web3.sha3('name'), owner, ownerValue, 2);
            sealedBid = result;

            await context.newBid(sealedBid, ownerValue, owner);

            await utils.increaseTime(utils.days(3) + 60);
            await registrar.unsealBid(web3.sha3('name'), notOwnerValue, 1, { from: notOwner });
            await registrar.unsealBid(web3.sha3('name'), ownerValue, 2, { from: owner });
            await utils.increaseTime(utils.days(2) + 60);
            await registrar.finalizeAuction(web3.sha3('name'), { from: owner });
            
            var entry = await registrar.entries(web3.sha3('name'));
            var deed = TokenDeed.at(entry[1])
            var initialDeedBalance = await deed.tokenQuantity();

            var initialBalance = await tokenContract.balanceOf(owner);

            await registrar.releaseDeed(web3.sha3('name'), { from: owner });
            var result = await registrar.entries(web3.sha3('name'));
            assert.equal(result[0], 0);

            var finalBalance = await tokenContract.balanceOf(owner);

            var returned = finalBalance.sub(initialBalance).toNumber();
            console.log('\t Name released and ', web3.fromWei(returned, 'ether'), ' tokens returned to deed owner');

            assert.equal(initialDeedBalance.toNumber() * 0.8, returned);

            await registrar.startAuction(web3.sha3('name'), { from: owner });
            
            var result = await registrar.entries(web3.sha3('name'));
            
            // Check we can start an auction on the newly released name				
            assert.equal(result[0], 1);	
        });

        it("releases deed during the rent payment period", async function() {
            // Send tokens to auxiliary accounts
            for (var k = 1; k <= 1; k++)
                await tokenContract.transfer(accounts[k], utils.toTokens(2.5));

            var sealedBid = null;
            var winnerBalance = 0;
            var owner = accounts[1];
            var notOwner = accounts[0];

            await registrar.startAuction(web3.sha3('name'), { from: owner });
            var result = await registrar.shaBid(web3.sha3('name'), notOwner, utils.toTokens(1), 1);
            sealedBid = result;

            await context.newBid(sealedBid, utils.toTokens(1), notOwner);

            var result = await registrar.shaBid(web3.sha3('name'), owner, utils.toTokens(2), 2);
            sealedBid = result;

            await context.newBid(sealedBid, utils.toTokens(2), owner);

            await utils.increaseTime(utils.days(3) + 60);
            await registrar.unsealBid(web3.sha3('name'), utils.toTokens(1), 1, { from: notOwner });
            await registrar.unsealBid(web3.sha3('name'), utils.toTokens(2), 2, { from: owner });
            await utils.increaseTime(utils.days(2) + 60);
            await registrar.finalizeAuction(web3.sha3('name'), { from: owner });
            
            await utils.increaseTime(utils.months(9) + 60);

            var entry = await registrar.entries(web3.sha3('name'));
            var deed = TokenDeed.at(entry[1])
            var initialDeedBalance = await deed.tokenQuantity();

            var initialBalance = await tokenContract.balanceOf(owner);

            await registrar.releaseDeed(web3.sha3('name'), { from: owner });
            var result = await registrar.entries(web3.sha3('name'));
            assert.equal(result[0], 0);

            var finalBalance = await tokenContract.balanceOf(owner);

            var returned = finalBalance.sub(initialBalance).toNumber();
            console.log('\t Name released and ', web3.fromWei(returned, 'ether'), ' tokens returned to deed owner');

            assert.equal(initialDeedBalance.toNumber() * 0.8, returned);

            await registrar.startAuction(web3.sha3('name'), { from: owner });
            
            var result = await registrar.entries(web3.sha3('name'));
            
            // Check we can start an auction on the newly released name				
            assert.equal(result[0], 1);		
        });

        it("allows releasing a deed immediately when no longer the registrar", async function() {
            let bid = { account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0 };
            
            await registrar.startAuction(web3.sha3('name'), { from: bid.account });
            
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);

            await context.newBid(bid.sealedBid, bid.deposit);
            
            await utils.increaseTime(utils.days(3) + 60);
            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            await utils.increaseTime(utils.days(2) + 60);
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            await rns.setSubnodeOwner(0, web3.sha3(TLD), bid.account);
            await registrar.releaseDeed(web3.sha3('name'));
        });

        it('rejects bids less than the minimum', async function() {
            let bid = { account: accounts[0], value: utils.toTokens(0.1), deposit: utils.toTokens(1), salt: 1 }

            await registrar.startAuction(web3.sha3('name'));
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);

            await context.newBid(bid.sealedBid, bid.deposit, bid.account);
            
            await utils.increaseTime(utils.days(3) + 60);

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });
            
            var result = await registrar.entries(web3.sha3('name'));
            assert.equal(result[4], 0); // highestBid == 0
        });

        it("doesn't allow finalizing an auction early", async function() {
            let bid = { account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 1}
            
            await registrar.startAuction(web3.sha3('name'));
            
            // try to finalize before reveal
            await utils.assertThrowsAsync(async () => {
                await registrar.finalizeAuction(web3.sha3('name'));
            });

            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            
            await context.newBid(bid.sealedBid, bid.deposit);
            
            await utils.increaseTime(utils.days(3) + 60);
            
            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });
            
            // try to finalize during reveal
            await utils.assertThrowsAsync(async () => {
                await registrar.finalizeAuction(web3.sha3('name'));
            });

            await utils.increaseTime(utils.days(2) + 60);

            // don't let finalize to any other than the winner
            await utils.assertThrowsAsync(async () => {
                await registrar.finalizeAuction(web3.sha3('name'), { from: accounts[1] });
            });

            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });
        });

        it("allows finalizing an auction even when no longer the registrar", async function() {
            let bid = { account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 1 }
            
            await registrar.startAuction(web3.sha3('name'));
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            
            await context.newBid(bid.sealedBid, bid.deposit);
            
            await utils.increaseTime(utils.days(3) + 60);
            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });
            await utils.increaseTime(utils.days(2) + 60);
            
            await rns.setSubnodeOwner(0, web3.sha3(TLD), bid.account);

            await registrar.finalizeAuction(web3.sha3('name'));
        });

        it("doesn't allow revealing a bid on a name not up for auction", async function() {
            let bid = { account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 1 };

            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);

            await context.newBid(bid.sealedBid, bid.value);

            await utils.assertThrowsAsync(async () => {
                await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });
            });

            // Check reveal works after starting the auction
            await utils.increaseTime(utils.days(1));
            await registrar.startAuction(web3.sha3('name'));
            await utils.increaseTime(utils.days(3) + 60);
            
            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });
        });

        it('calling startAuction on a finished auction has no effect', async function() {
            let bid = { account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 1 };

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));

            // Place a bid on it
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);

            await context.newBid(bid.sealedBid, bid.deposit);
            
            // Advance 3 days to the reveal period
            await utils.increaseTime(utils.days(3) + 60);

            // Reveal the bid
            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });
            
            let auctionStatus = await registrar.entries(web3.sha3('name'));

            // Advance another two days to the end of the auction
            await utils.increaseTime(utils.days(2));

            await utils.assertThrowsAsync(async () => {
                await registrar.startAuction(web3.sha3('name'));
            });

            // Check that the deed is still set correctly
            var result = await registrar.entries(web3.sha3('name'));
            assert.deepEqual(auctionStatus.slice(1), result.slice(1));
        });

        it('takes the min of declared and provided value', async function() {
            let auctionStatus;
            
            await tokenContract.transfer(accounts[1], utils.toTokens(10000), { from: accounts[0] });

            let winnerBid = { account: accounts[1], value: utils.toTokens(4), deposit: utils.toTokens(3), salt: 1 };
            let loserBid = { account: accounts[0], value: utils.toTokens(2), deposit: utils.toTokens(1), salt: 0 };

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));

            winnerBid.sealedBid = await registrar.shaBid(web3.sha3('name'), winnerBid.account, winnerBid.value, winnerBid.salt);
            loserBid.sealedBid = await registrar.shaBid(web3.sha3('name'), loserBid.account, loserBid.value, loserBid.salt);

            await context.newBid(winnerBid.sealedBid, winnerBid.deposit, winnerBid.account);
            await context.newBid(loserBid.sealedBid, loserBid.deposit, loserBid.account);

            // Advance 3 days to the reveal period
            await utils.increaseTime(utils.days(3) + 60);

            // Reveal the bids and check they're processed correctly.
            await registrar.unsealBid(web3.sha3('name'), loserBid.value, loserBid.salt, { from: loserBid.account });
            auctionStatus = await registrar.entries(web3.sha3('name'));
            assert.equal(auctionStatus[3].toNumber(), 0);
            assert.equal(auctionStatus[4].toNumber(), loserBid.deposit);

            await registrar.unsealBid(web3.sha3('name'), winnerBid.value, winnerBid.salt, { from: winnerBid.account });
            auctionStatus = await registrar.entries(web3.sha3('name'));
            assert.equal(auctionStatus[3].toNumber(), loserBid.deposit);
            assert.equal(auctionStatus[4].toNumber(), winnerBid.deposit);
        });	

        it('supports transferring domains to another account', async function() {
            const bid = { account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(2), salt: 1 };
            const otherAccount = accounts[1];

            await registrar.startAuction(web3.sha3('name'));

            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);

            await context.newBid(bid.sealedBid, bid.deposit);

            await utils.increaseTime(utils.days(3) + 60);

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Make sure we can't transfer it yet
            await utils.assertThrowsAsync(async () => {
                await registrar.transfer(web3.sha3('name'), otherAccount, { from: bid.account});
            });

            await utils.increaseTime(utils.days(2));

            await registrar.finalizeAuction(web3.sha3('name'));

            const entry = await registrar.entries(web3.sha3('name'));
            const deedAddress = entry[1];

            // Try and transfer it when we don't own it
            await utils.assertThrowsAsync(async () => {
                await registrar.transfer(web3.sha3('name'), otherAccount, { from: otherAccount });
            });

            // Transfer ownership to another account
            await registrar.transfer(web3.sha3('name'), otherAccount, { from: bid.account});

            // Check the new owner was set on the deed
            const deed = TokenDeed.at(deedAddress);
            let owner = await deed.owner();
            assert.equal(otherAccount, owner);

            // Check the new owner was set in RNS
            owner = await rns.owner(nameDotRsk);
            assert.equal(otherAccount, owner);
        });

        it('prohibits bids during the reveal period', async function() {
            const bid = { account: accounts[0], value: utils.toTokens(1.5), deposit: utils.toTokens(0.1), salt: 1 };

            bid.startingBalance = await tokenContract.balanceOf(bid.account);

            await registrar.startAuction(web3.sha3('name'));

            // advance 3 days to reveal period
            await utils.increaseTime(utils.days(3) + 60);

            // place bid
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);

            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // reveal bid
            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // check the unsealed bid wasn't taken
            const entry = await registrar.entries(web3.sha3('name'));
            assert.equal(entry[1], "0x0000000000000000000000000000000000000000");
        });

        it("prohibits starting auctions when it's not the registrar", async function() {
            await rns.setSubnodeOwner(0, web3.sha3(TLD), accounts[0]);

            await utils.assertThrowsAsync(async() => {
                await registrar.startAuction(web3.sha3('name'), { from: accounts[0] });
            });
        });

        it("permits anyone to zero out RNS records not associated with an owned name", async function() {
            var subdomainDotNameDotRsk = web3.sha3(nameDotRsk + web3.sha3('subdomain').slice(2), { encoding: 'hex' });

            // Set the node owners and resolvers
            await rns.setSubnodeOwner(0, web3.sha3(TLD), accounts[0]);
            await rns.setSubnodeOwner(dotRsk, web3.sha3('name'), accounts[0]);
            await rns.setSubnodeOwner(nameDotRsk, web3.sha3('subdomain'), accounts[0]);

            await rns.setResolver(nameDotRsk, accounts[0]);
            await rns.setResolver(subdomainDotNameDotRsk, accounts[0]);

            // Set the registrar as the owner of tld again
            await rns.setOwner(dotRsk, registrar.address);

            // Call the eraseNode method
            await registrar.eraseNode([web3.sha3("subdomain"), web3.sha3("name")], { from: accounts[1] });

            // Check that the owners and resolvers have all been set to zero
            let resolver = await rns.resolver(subdomainDotNameDotRsk);
            assert.equal(resolver, 0);

            let owner = await rns.owner(subdomainDotNameDotRsk);
            assert.equal(owner, 0);

            resolver = await rns.resolver(nameDotRsk);
            assert.equal(resolver, 0);

            owner = await rns.owner(nameDotRsk);
            assert.equal(owner, 0);
        });

        it("does not permit owned names to be zeroed", async function() {
            let bid = { account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 1 }

            await registrar.startAuction(web3.sha3('name'));

            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);

            await context.newBid(bid.sealedBid, bid.deposit);

            await utils.increaseTime(utils.days(3) + 60);

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            await utils.increaseTime(utils.days(2));

            await registrar.finalizeAuction(web3.sha3('name'));

            await utils.assertThrowsAsync(async() => {
                await registrar.eraseNode([web3.sha3('name')]);
            });
        });

        it("does not permit an empty name to be zeroed", async function() {
            await utils.assertThrowsAsync(async () => {
                await registrar.eraseNode([]);
            });
        });

        it("does not allow bidders to replay others' bids", async function() {
            await registrar.startAuction(web3.sha3('name'));

            let bid = { account: accounts[1], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 1 };

            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);

            await context.newBid(bid.sealedBid, bid.deposit);

            await utils.increaseTime(utils.days(3) + 60);

            await utils.assertThrowsAsync(async () => {
                await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: accounts[0] });
            });
        });

        it("takes 20% of a late unsealed bid that would have won", async function () {
            // Send tokens to auxiliary accounts
            for (var k = 1; k <= 5; k++)
                await tokenContract.transfer(accounts[k], utils.toTokens(10));

            var bidData = [
                // A regular bid
                {description: 'A regular bid', account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(2), salt: 1, expectedFee: 0 },
                // A better bid
                {description: 'Winning bid', account: accounts[1], value: utils.toTokens(2), deposit: utils.toTokens(2), salt: 2, expectedFee: 0.5 },
                // An even better bid that is revealed late. Take 20% as fee
                {description: 'Bid revealed late that would have won', account: accounts[2], value: utils.toTokens(2.1), deposit: utils.toTokens(2.1), salt: 3, expectedFee: 0.2 },
            ];

            for (var nb = 0; nb < bidData.length; nb++) {
                var bid = bidData[nb];
                var tokenBalance = await tokenContract.balanceOf(bid.account);
                bid.startingBalance = tokenBalance.toFixed();
            }

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));

            for (var nb = 0; nb < bidData.length; nb++) {
                var bid = bidData[nb];
                var tokenBalance = await tokenContract.balanceOf(bid.account);
                bid.startingBalance = tokenBalance.toFixed();
                var result = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
                bid.sealedBid = result;

                await context.newBid(bid.sealedBid, bid.deposit, bid.account);
            }

            // Advance 3 days to the reveal period
            await utils.increaseTime(utils.days(3) + 60);

            // Start an auction for 'anothername' to force time update
            await registrar.startAuction(web3.sha3('anothername'));

            // Reveal all the bids but the last
            for (var nb = 0; nb < bidData.length - 1; nb++) {
                var bid = bidData[nb];
                await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, {from: bid.account});
            }

            // Advance another two days to the end of the auction
            await utils.increaseTime(utils.days(2));

            // Finalize the auction
            await registrar.finalizeAuction(web3.sha3('name'), {from: accounts[1]});

            // Reveal a late bid that could have won
            const lateBid = bidData[2];
            await registrar.unsealBid(web3.sha3('name'), lateBid.value, lateBid.salt, {from: lateBid.account});

            // Check balances
            for (var nb = 0; nb < bidData.length; nb++) {
                var bid = bidData[nb];

                var tokenBalance = await tokenContract.balanceOf(bid.account);
                var spentFee = Math.floor(10000*(bid.startingBalance - tokenBalance.toFixed()) / Math.min(bid.value, bid.deposit))/10000;
                console.log('\t Bidder #' + bid.salt, bid.description + '. Spent:', 100 * spentFee + '%; Expected:', 100 * bid.expectedFee + '%;');
                assert.equal(spentFee, bid.expectedFee);
            }

            // Check the owner didn't change
            const owner = await rns.owner(nameDotRsk);
            assert.equal(owner, accounts[1]);
        });
        
        it("takes the difference of a late unsealed bid that would have affected the price with the actual second highest bid", async function () {
            // Send tokens to auxiliary accounts
            for (var k = 1; k <= 5; k++)
                await tokenContract.transfer(accounts[k], utils.toTokens(10));

            var bidData = [
                // A regular bid
                {description: 'A regular bid', account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(2), salt: 1, expectedFee: 0 },
                // A better bid
                {description: 'Winning bid', account: accounts[1], value: utils.toTokens(2), deposit: utils.toTokens(2), salt: 2, expectedFee: 0.5 },
                // An even better bid that is revealed late. Takes the difference as fee: 1.25-1.0=0.25 -> 0.25/1.25=0.2
                {description: 'Bid revealed late that would have affected the price', account: accounts[2], value: utils.toTokens(1.25), deposit: utils.toTokens(2), salt: 3, expectedFee: 0.2 },
            ];

            for (var nb = 0; nb < bidData.length; nb++) {
                var bid = bidData[nb];
                var tokenBalance = await tokenContract.balanceOf(bid.account);
                bid.startingBalance = tokenBalance.toFixed();
            }

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));

            for (var nb = 0; nb < bidData.length; nb++) {
                var bid = bidData[nb];
                var tokenBalance = await tokenContract.balanceOf(bid.account);
                bid.startingBalance = tokenBalance.toFixed();
                var result = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
                bid.sealedBid = result;

                await context.newBid(bid.sealedBid, bid.deposit, bid.account);
            }

            // Advance 3 days to the reveal period
            await utils.increaseTime(utils.days(3) + 60);

            // Start an auction for 'anothername' to force time update
            await registrar.startAuction(web3.sha3('anothername'));

            // Reveal all the bids but the last
            for (var nb = 0; nb < bidData.length - 1; nb++) {
                var bid = bidData[nb];
                await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, {from: bid.account});
            }

            // Advance another two days to the end of the auction
            await utils.increaseTime(utils.days(2));

            // Finalize the auction
            await registrar.finalizeAuction(web3.sha3('name'), {from: accounts[1]});

            // Reveal a late bid that could have affected the price
            const lateBid = bidData[2];
            await registrar.unsealBid(web3.sha3('name'), lateBid.value, lateBid.salt, {from: lateBid.account});

            // Check balances
            for (var nb = 0; nb < bidData.length; nb++) {
                var bid = bidData[nb];

                var tokenBalance = await tokenContract.balanceOf(bid.account);
                var spentFee = Math.floor(10000*(bid.startingBalance - tokenBalance.toFixed()) / Math.min(bid.value, bid.deposit))/10000;
                console.log('\t Bidder #' + bid.salt, bid.description + '. Spent:', 100 * spentFee + '%; Expected:', 100 * bid.expectedFee + '%;');
                assert.equal(spentFee, bid.expectedFee);
            }
        });

        it("takes 0.5% of a late unsealed bid that would have won", async function () {
            // Send tokens to auxiliary accounts
            for (var k = 1; k <= 5; k++)
                await tokenContract.transfer(accounts[k], utils.toTokens(10));

            var bidData = [
                // A regular bid
                {description: 'A regular bid', account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(2), salt: 1, expectedFee: 0 },
                // A better bid
                {description: 'Winning bid', account: accounts[1], value: utils.toTokens(2), deposit: utils.toTokens(2), salt: 2, expectedFee: 0.5 },
                // An even better bid that is revealed late. 0.5% taken as fee
                {description: 'Bid revealed late that would have lost', account: accounts[2], value: utils.toTokens(0.5), deposit: utils.toTokens(2), salt: 3, expectedFee: 0.005 },
            ];

            for (var nb = 0; nb < bidData.length; nb++) {
                var bid = bidData[nb];
                var tokenBalance = await tokenContract.balanceOf(bid.account);
                bid.startingBalance = tokenBalance;
            }

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));

            for (var nb = 0; nb < bidData.length; nb++) {
                var bid = bidData[nb];
                var tokenBalance = await tokenContract.balanceOf(bid.account);
                bid.startingBalance = tokenBalance;
                var result = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
                bid.sealedBid = result;

                await context.newBid(bid.sealedBid, bid.deposit, bid.account);
            }

            // Advance 3 days to the reveal period
            await utils.increaseTime(utils.days(3) + 60);

            // Start an auction for 'anothername' to force time update
            await registrar.startAuction(web3.sha3('anothername'));

            // Reveal all the bids but the last
            for (var nb = 0; nb < bidData.length - 1; nb++) {
                var bid = bidData[nb];
                await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, {from: bid.account});
            }

            // Advance another two days to the end of the auction
            await utils.increaseTime(utils.days(2));

            // Finalize the auction
            await registrar.finalizeAuction(web3.sha3('name'), {from: accounts[1]});

            // Reveal a late bid that would have lost
            const lateBid = bidData[2];
            await registrar.unsealBid(web3.sha3('name'), lateBid.value, lateBid.salt, {from: lateBid.account});

            // Check balances
            for (var nb = 0; nb < bidData.length; nb++) {
                var bid = bidData[nb];

                var tokenBalance = await tokenContract.balanceOf(bid.account);
                // var spentFee = Math.floor(10000*(bid.startingBalance - tokenBalance) / Math.min(bid.value, bid.deposit))/10000;
                var spentFee = Math.floor(10000*(bid.startingBalance.sub(tokenBalance)) / Math.min(bid.value, bid.deposit))/10000;
                
                console.log('\t Bidder #' + bid.salt, bid.description + '. Spent:', 100 * spentFee + '%; Expected:', 100 * bid.expectedFee + '%;');
                assert.equal(spentFee, bid.expectedFee);
            }
        });
        
        it("takes 100% as fee if the bid is revealed after the late unseal period of a concluded auction", async function() {
            await tokenContract.transfer(accounts[1], utils.toTokens(25), { from:accounts[0] });

            const winnerBid = { account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(2), salt: 1 }
            const lateBid = { account: accounts[1], value: utils.toTokens(1.5), deposit: utils.toTokens(2), salt: 0 };

            lateBid.startingBalance = await tokenContract.balanceOf(lateBid.account);

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));

            winnerBid.sealedBid = await registrar.shaBid(web3.sha3('name'), winnerBid.account, winnerBid.value, winnerBid.salt);
            lateBid.sealedBid = await registrar.shaBid(web3.sha3('name'), lateBid.account, lateBid.value, lateBid.salt);

            let data = "";
            await context.newBid(winnerBid.sealedBid, winnerBid.deposit, winnerBid.account);
            await context.newBid(lateBid.sealedBid, lateBid.deposit, lateBid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);

            await registrar.unsealBid(web3.sha3('name'), winnerBid.value, winnerBid.salt, { from: winnerBid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            // Finalize auction
            await registrar.finalizeAuction(web3.sha3('name'), { from: winnerBid.account });

            // Advance past the late unsealing period
            await utils.increaseTime(utils.days(15));

            // Start an auction for 'anothername' to force time update
            await registrar.startAuction(web3.sha3('anothername'));

            // Reveal late bid
            await registrar.unsealBid(web3.sha3('name'), lateBid.value, lateBid.salt, {from: lateBid.account});

            var tokenBalance = await tokenContract.balanceOf(lateBid.account);
            assert.equal(lateBid.startingBalance - tokenBalance, lateBid.value);

            const owner = await rns.owner(nameDotRsk);
            assert.equal(owner, accounts[0]);
        });

        it("creates deeds with 1 year expiry time from the auction's finish", async function () {
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            // retrieve the deed
            const entry = await registrar.entries(web3.sha3('name'));
            const deed = TokenDeed.at(entry[1]);
            const registrationDate = entry[2];
            const expirationDate = await deed.expirationDate();

            assert.equal(expirationDate - registrationDate, utils.years(1));
        });

        it("creates deeds with 1 year expiry time from the auction's finish when calling finalizeAuction a week after the finish date", async function () {
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            // Advance even further in time
            await utils.increaseTime(utils.months(1));

            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            // retrieve the deed
            const entry = await registrar.entries(web3.sha3('name'));
            const deed = TokenDeed.at(entry[1]);
            const registrationDate = entry[2];
            const expirationDate = await deed.expirationDate();

            assert.equal(expirationDate - registrationDate, utils.years(1));
        });

        it("increases the expiration date 1 year when the user pays the rent", async function() {
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            // Finalize auction
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            // retrieve the deed
            const entry = await registrar.entries(web3.sha3('name'));
            const deed = TokenDeed.at(entry[1]);
            const initialExpirationDate = await deed.expirationDate();

            // move to rent payment period
            await utils.increaseTime(utils.months(9));

            // pay during the pay rent period
            await context.payRent(web3.sha3('name'), RENT_VALUE, bid.account);

            // check the expiry date moved one year further
            const newExpirationDate = await deed.expirationDate();
            assert.equal(newExpirationDate - initialExpirationDate, utils.years(1));
        });

        it("substracts the rent amount in tokens when the user pays it", async function() {
            await tokenContract.transfer(accounts[1], utils.toTokens(2), {from:accounts[0]});
            
            const bid = {account: accounts[1], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            // Finalize auction
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            // move to rent payment period
            await utils.increaseTime(utils.months(9));

            // pay during the pay rent period
            await context.payRent(web3.sha3('name'), RENT_VALUE, bid.account);

            // check the funds were substracted (110 - 100 (deposited) - 10 (rent) = 0)
            const balance = await tokenContract.balanceOf(bid.account);
            assert.equal(balance, 0);
        });

        it("does throw when the user pays the rent for the second year after paying the first due to inconsistent payment period range", async function () {
            /*  this test covers a bug where payRent wouldn't throw since the start of the payment period would be calculated
                from the bid's creation date instead of the expiration date  */

            const bid = { account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0 }

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));

            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);

            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            // Finalize auction
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            // move to rent payment period
            await utils.increaseTime(utils.months(9));

            // pay during the pay rent period
            await context.payRent(web3.sha3('name'), RENT_VALUE, bid.account);

            // try to pay again
            await utils.assertThrowsAsync(async () => {
                await context.payRent(web3.sha3('name'), RENT_VALUE, bid.account);
            });

            // advance to the next rent payment period
            await utils.increaseTime(utils.years(1));

            // pay for the second year
            await context.payRent(web3.sha3('name'), RENT_VALUE, bid.account);
        })

        it("doesn't let the user pay the rent before the rent payment period", async function() {
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            let elapsedTime = 0;

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);
            elapsedTime += utils.days(3) + 1;

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(3));
            elapsedTime += utils.days(3);

            // Finalize auction
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            // advance 5 minutes before the start of the rent payment period
            const entry = await registrar.entries(web3.sha3('name'));
            const deed = TokenDeed.at(entry[1]);

            const expDate = (await deed.expirationDate()).toFixed();
            const paymentPeriodStart = expDate - utils.months(3); // 3 months for the rent payment period

            // substract the elapsed time since there is a difference between the new Date() and the current VM date
            let timeToPaymentPeriodStart = paymentPeriodStart - utils.dateToSec(new Date()) - elapsedTime;

            await utils.increaseTime(timeToPaymentPeriodStart - utils.minutes(5));

            await utils.assertThrowsAsync(async () => { 
                await context.payRent(web3.sha3('name'), RENT_VALUE, bid.account);
            });
        });

        it("doesn't let the user pay the rent after the rent payment period", async function() {
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            // Finalize auction
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            // move beyond the expiry date
            await utils.increaseTime(utils.years(2));
            
            await registrar.startAuction(web3.sha3('anothername'));
            
            // try to pay the rent after the period is over
            await utils.assertThrowsAsync(async () => { 
                await context.payRent(web3.sha3('name'), RENT_VALUE, bid.account);
            });
        });

        it("doesn't let a user pay the rent for another user's domain", async function() {
            await tokenContract.transfer(accounts[1], utils.toTokens(10), {from:accounts[0]});
            
            const bid = {account: accounts[1], value: utils.toTokens(1), deposit: utils.toTokens(1) + INITIAL_BID_FEE, salt: 0}
            const otherAccount = accounts[2];

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            // Finalize auction
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            // move to rent payment period
            await utils.increaseTime(utils.months(9));

            // try to pay with another account
            await utils.assertThrowsAsync(async () => {
                await context.payRent(web3.sha3('name'), RENT_VALUE, otherAccount);
            });
        });

        // TODO: check if redundant. There are already checks for ownership (which only allows Owned state) and payment period
        it("doesn't let a user pay rent for a name during its auction", async function() { 
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            // try to pay the rent for a name not even auctioned
            await utils.assertThrowsAsync(async () => { 
                await context.payRent(web3.sha3('name'), RENT_VALUE, bid.account);
            });

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // try to pay the rent after making a bid
            await utils.assertThrowsAsync(async () => { 
                await context.payRent(web3.sha3('name'), RENT_VALUE, bid.account);
            });
            
            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);

            // try to pay the rent for a name during reveal period
            await utils.assertThrowsAsync(async () => { 
                await context.payRent(web3.sha3('name'), RENT_VALUE, bid.account);
            });

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));
        });

        it("doesn't let a user pay rent for a closed deed", async function() { 
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));

            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);

            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            // Finalize auction
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            // move to rent payment period
            await utils.increaseTime(utils.months(9));

            // release the name
            await registrar.releaseDeed(web3.sha3('name'), { from: bid.account });

            // try to pay for a released name
            await utils.assertThrowsAsync(async () => {
                await context.payRent(web3.sha3('name'), RENT_VALUE, bid.account);
            });
        });

        it("doesn't let a user pay rent for an expired name", async function() { 
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            // Finalize auction
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            // move beyond the expiration date
            await utils.increaseTime(utils.months(13));

            // try to pay for an expired name
            await utils.assertThrowsAsync(async () => {
                await context.payRent(web3.sha3('name'), RENT_VALUE, bid.account);
            });
        });

        it("returns code 'Open' when a name is expired", async() => {	
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            // Finalize auction
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            // move beyond the expiration date
            await utils.increaseTime(utils.months(13));

            // check it's back to open
            const entry = await registrar.entries(web3.sha3('name'));
            assert.equal(entry[0].toNumber(), 0);
        });

        it("lets anybody open an auction for an expired domain", async() => {
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            // Finalize auction
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            // move beyond the expiration date
            await utils.increaseTime(utils.months(13));

            let entries = await registrar.entries(web3.sha3('name'));
            const deed = TokenDeed.at(entries[1]);
            deed.closeExpiredDeed();

            // try to open an auction for it again
            await registrar.startAuction(web3.sha3('name'));
        });

        it("shouldn't let the owner release the deed after it expired", async() => {
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);

            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            // Finalize auction
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            // move beyond the expiration date
            await utils.increaseTime(utils.months(13));

            // try to open an auction for it again
            await utils.assertThrowsAsync();
            
            // try to release the deed
            await utils.assertThrowsAsync(async () => {
                await registrar.releaseDeed(web3.sha3('name'), {from: bid.account});
            });
        });
        
        it("lets anybody start an auction and win it for an expired name", async() => {
            await tokenContract.transfer(accounts[1], utils.toTokens(25), { from: accounts[0] });
            
            const firstOwnerBid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}
            const secondOwnerBid = {account: accounts[1], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 1}

            let data = null;

            // First auction
            await registrar.startAuction(web3.sha3('name'));
            firstOwnerBid.sealedBid = await registrar.shaBid(web3.sha3('name'), firstOwnerBid.account, firstOwnerBid.value, firstOwnerBid.salt);
            await context.newBid(firstOwnerBid.sealedBid, firstOwnerBid.deposit, firstOwnerBid.account);
            await utils.increaseTime(utils.days(3) + 1);
            await registrar.unsealBid(web3.sha3('name'), firstOwnerBid.value, firstOwnerBid.salt, { from: firstOwnerBid.account });
            await utils.increaseTime(utils.days(2));
            await registrar.finalizeAuction(web3.sha3('name'), { from: firstOwnerBid.account });

            // move beyond the expiration date
            await utils.increaseTime(utils.months(13));

            // Second auction
            await registrar.startAuction(web3.sha3('name'));
            secondOwnerBid.sealedBid = await registrar.shaBid(web3.sha3('name'), secondOwnerBid.account, secondOwnerBid.value, secondOwnerBid.salt);
            await context.newBid(secondOwnerBid.sealedBid, secondOwnerBid.deposit, secondOwnerBid.account);
            await utils.increaseTime(utils.days(3) + 1);
            await registrar.unsealBid(web3.sha3('name'), secondOwnerBid.value, secondOwnerBid.salt, { from: secondOwnerBid.account });
            await utils.increaseTime(utils.days(2));
            await registrar.finalizeAuction(web3.sha3('name'), { from: secondOwnerBid.account });

            const owner = await rns.owner(nameDotRsk);
            assert.equal(owner, accounts[1]);
        });
        
        it("sets the entry to initial values after starting an auction for an expired name", async() => {
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));		
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);
            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            // Finalize auction
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            // move beyond the expiration date
            await utils.increaseTime(utils.months(13));

            // invalidate the name
            await registrar.startAuction(web3.sha3('name'));
            
            // assert the entry is on it's initial state
            const entry = await registrar.entries(web3.sha3('name'));
            assert.equal(entry[1], 0); // address
            assert.equal(entry[3], 0); // value
            assert.equal(entry[4], 0); // highestBid
        });

        it("allows anyone to close an expired deed", async() => {
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            const originalAccountBalance = await tokenContract.balanceOf(bid.account);

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));		
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);
            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            // Finalize auction
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            // move beyond the expiration date
            await utils.increaseTime(utils.months(13));

            let entry = await registrar.entries(web3.sha3('name'));
            const deed = TokenDeed.at(entry[1]);
            const deedValue = await deed.tokenQuantity();

            // invalidate the name
            await deed.closeExpiredDeed({ from: accounts[1] });
            
            // check the balance of the resource pool address (should be the minimum amount since there is only one participant)
            const tokenBalance = await tokenContract.balanceOf(RESOURCE_POOL_ADDRESS);
            assert.equal(tokenBalance.toNumber(), deedValue.toNumber() + INITIAL_BID_FEE);

            // check the balance of the deed contract is 0
            const deedBalance = await tokenContract.balanceOf(deed.address);
            assert.equal(deedBalance.toNumber(), 0);

            // check the funds were not returned to the user
            const newAccountBalance = await tokenContract.balanceOf(bid.account);

            const expectedBalance = originalAccountBalance.sub(deedValue).sub(INITIAL_BID_FEE);
            assert.ok(newAccountBalance.eq(expectedBalance)); // Use BigNumber.js methods
        });

        it("does not allow to close a non expired deed", async() => {
            await tokenContract.transfer(accounts[1], utils.toTokens(10), {from:accounts[0]});

            const bid = {account: accounts[0], value: utils.toTokens(2), deposit: utils.toTokens(1), salt: 0}

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));

            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            const deedAddr = await registrar.sealedBids(bid.account, bid.sealedBid);
            const deed = TokenDeed.at(deedAddr);

            await utils.assertThrowsAsync(async () => {
                await deed.closeExpiredDeed();
            });
        });

        it("does not allow to close a non expired, winning deed", async() => {
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));		
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);
            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            // Finalize auction
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            await utils.increaseTime(utils.days(5));
            
            // retrieve deed
            let entry = await registrar.entries(web3.sha3('name'));
            const deed = TokenDeed.at(entry[1]);

            // try to invalidate when not expired
            await utils.assertThrowsAsync(async () => {
                await deed.closeExpiredDeed();
            });
        });

        it("sends the correct amount of initial rent fees to the resource pool address", async() => {
            await tokenContract.transfer(accounts[1], utils.toTokens(1.1), {from:accounts[0]});
            await tokenContract.transfer(accounts[2], utils.toTokens(1.05), {from:accounts[0]});

            const winnerBid = { account: accounts[1], value: utils.toTokens(1.1), deposit: utils.toTokens(1.1), salt: 1 };
            const loserBid = { account: accounts[2], value: utils.toTokens(1.05), deposit: utils.toTokens(1.05), salt: 2 };
            
            const bids = [ winnerBid, loserBid ]

            await registrar.startAuction(web3.sha3('name'));
            for (let bid of bids) {
                bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
                await context.newBid(bid.sealedBid, bid.deposit, bid.account);
            }

            await utils.increaseTime(utils.days(3) + 1);
            for (let bid of bids) {
                await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, {from: bid.account});
            }

            await utils.increaseTime(utils.days(2));
            await registrar.finalizeAuction(web3.sha3('name'), {from:winnerBid.account});

            // check token balance matches the amount of fees
            const tokenBalance = await tokenContract.balanceOf(RESOURCE_POOL_ADDRESS);
            assert.equal(tokenBalance.toNumber(), INITIAL_BID_FEE * 1);

            // check balance participant's balances
            const winnerBalance = await tokenContract.balanceOf(winnerBid.account);
            assert.equal(winnerBalance.toNumber(), utils.toTokens(0.05));
            const loserBalance = await tokenContract.balanceOf(loserBid.account);
            assert.equal(loserBalance.toNumber(), utils.toTokens(1.05));
        });

        it("sets a default resolver for new nodes", async() => {
            const bid = {account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0}

            // Start an auction for 'name'
            await registrar.startAuction(web3.sha3('name'));
            bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);
            await context.newBid(bid.sealedBid, bid.deposit, bid.account);

            // Advance to reveal period
            await utils.increaseTime(utils.days(3) + 1);
            await registrar.unsealBid(web3.sha3('name'), bid.value, bid.salt, { from: bid.account });

            // Advance past auction's end
            await utils.increaseTime(utils.days(2));

            // Finalize auction
            await registrar.finalizeAuction(web3.sha3('name'), { from: bid.account });

            // Verify the resolver is the default previously set
            const resolverAddr = await rns.resolver(nameDotRsk);
            assert.equal(resolverAddr, publicResolver.address);
        });

        it("doesn't let a non owner of the root domain change the default resolver", async() => {
            await utils.assertThrowsAsync(async () => {
                await rns.setDefaultResolver("0x12345", { from: accounts[1] });
            });
        });

        it('starts multiple auctions', async function() {
            await registrar.startAuction(web3.sha3('name'));

            let hashes = [web3.sha3('name1'), web3.sha3('name2'), web3.sha3('name3')];

            for (let h of hashes) {
                var result = await registrar.entries(h);

                assert.equal(result[0], 0); // status == Open
            }

            await registrar.startAuctions(hashes);

            for (let h of hashes) {
                var result = await registrar.entries(h);

                assert.equal(result[0], 1); // status == Auction
            }

            await utils.increaseTime(utils.days(5) + 1);

            for (let h of hashes) {
                var result = await registrar.entries(h);

                assert.equal(result[0], 0); // status == Open
            }
        });

        if (contextDescription == "ERC20 token") {
            it('starts and bids', async function() {
                let hashes = [web3.sha3('name'), web3.sha3('anothername')]

                const bid = { account: accounts[0], value: utils.toTokens(1), deposit: utils.toTokens(1), salt: 0 }
                bid.sealedBid = await registrar.shaBid(web3.sha3('name'), bid.account, bid.value, bid.salt);

                await tokenContract.approve(registrar.address, bid.deposit, { from: bid.account });

                await registrar.startAuctionsAndBid(hashes, bid.sealedBid, bid.deposit, { from: bid.account });

                for (let h of hashes) {
                    let result = await registrar.entries(h);

                    assert.equal(result[0], 1);
                }

                let deedAddr = await registrar.sealedBids(bid.account, bid.sealedBid);
                console.log(deedAddr);
            });
        }
    });
}