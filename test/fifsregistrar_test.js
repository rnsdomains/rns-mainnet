const assert = require('assert');
const namehash = require("eth-ens-namehash").hash;

const RNS = artifacts.require("./RNS.sol");
const ERC677 = artifacts.require("./ERC677TokenContract.sol");
const FixedFeeFIFSRegistrar = artifacts.require("./FixedFeeFIFSRegistrar.sol");
const MigrationTestRegistrar = artifacts.require("./MigrationTestRegistrar.sol");

const { assertThrowsAsync, years, months } = require('./utils.js');

const contexts = require('./ERCContexts/ERCContexts');

// redefine increaseTime and add a getCurrentTime method since we can advance time but not reset it
let { increaseTime } = require('./utils.js');
let timeOffset = 0;
const oldIncreaseTime = increaseTime;
increaseTime = (t) => {
    oldIncreaseTime(t);
    timeOffset += t;
}
const getCurrentTime = () => (Math.trunc(+new Date() / 1000) + timeOffset);

for (const key in contexts) {
    const contextDescription = contexts[key].description,
          Context = contexts[key].constructor;

    contract(`${contextDescription} FixedFeeFIFSRegistrar`, async function(accounts) {
        const TLD = "test";
        const NAME = "name";

        const ACC0 = accounts[0];
        const ACC1 = accounts[1];
        const ACC2 = accounts[2];
        const RESOURCE_POOL = accounts[3];
        const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

        const HIGH_FEE_VAL = web3.toWei("2");
        const FEE_VAL = web3.toWei("1");
        const LOW_FEE_VAL = web3.toWei("0.99");

        const STATES = {
            OPEN: 0,
            OWNED: 2,
            EXPIRED: 5,
            RENEW: 6
        }

        let rns, registrar, tokenContract;
        let context;

        beforeEach(async function () {
            rns = await RNS.new();
            tokenContract = await ERC677.new(ACC0, 1e28, {from:ACC0});
            registrar = await FixedFeeFIFSRegistrar.new(rns.address, namehash(TLD), FEE_VAL, FEE_VAL, tokenContract.address, RESOURCE_POOL);
            await rns.setSubnodeOwner(0, web3.sha3(TLD), registrar.address);
    
            await tokenContract.transfer(ACC1, 1e24, {from:ACC0});
            await tokenContract.transfer(ACC2, 1e24, {from:ACC0});

            context = new Context(tokenContract, registrar, accounts);
        });

        describe("creation", async function () {
            it("creates with the correct parameters", async function () {
                assert.equal(await registrar.rns(), rns.address, "incorrect rns address");
                assert.equal(await registrar.rootNode(), namehash(TLD), "incorrect root node");
                assert.equal(await registrar.registerFeeValue(), FEE_VAL, "incorrect registration fee value");
                assert.equal(await registrar.renewFeeValue(), FEE_VAL, "incorrect renewal fee value");
                assert.equal(await registrar.tokenContract(), tokenContract.address, "incorrect token contract address");
                assert.equal(await registrar.resourcePool(), RESOURCE_POOL, "incorrect fee collector address");
            });
        });

        describe("token fallback", async function () {
            it("throws when called from an address other than the token contract", async function () {
                await assertThrowsAsync(async function () {
                    await registrar.tokenFallback(ACC1, FEE_VAL, "0x012345670123456701234567");
                });

                let balance = await tokenContract.balanceOf(registrar.address);
                assert.ok(balance.eq(0));
            });

            it("throws when called with a short data argument (less than 4 bytes)", async function () {
                await assertThrowsAsync(async function () {
                    await tokenContract.transferAndCall(registrar.address, FEE_VAL, '0x00', { from: ACC1 });
                });

                let balance = await tokenContract.balanceOf(registrar.address);
                assert.ok(balance.eq(0));
            });

            it("throws when called with an invalid data argument (less than 4 bytes)", async function () {
                await assertThrowsAsync(async function () {
                    await tokenContract.transferAndCall(registrar.address, FEE_VAL, '0x01234567' + web3.sha3(NAME).substr(2), { from: ACC1 });                    
                });

                let balance = await tokenContract.balanceOf(registrar.address);
                assert.ok(balance.eq(0));
            });
        })

        describe("registration", async function () {
            it("succesfully sets ownership after registering a name", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);

                let node = namehash(`${NAME}.${TLD}`);
    
                let owner = await rns.owner(node);
                assert.equal(owner, ACC1, "owner different than the registrant");
            });
    
            it("succesfully collects the fee after registering a name", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
    
                let balance = await tokenContract.balanceOf(RESOURCE_POOL);
                assert.equal(balance.toString(), FEE_VAL);
            });
    
            it("fails when sending a fee below the required", async function () {
                await assertThrowsAsync(async () => {
                    await context.register(web3.sha3(NAME), LOW_FEE_VAL, ACC1);                
                });
            });
    
            it("transfers back the difference between the sent and registration fee values", async function () {
                let oldBalance = await tokenContract.balanceOf(ACC1);
    
                await context.register(web3.sha3(NAME), HIGH_FEE_VAL, ACC1);                
    
                let newBalance = await tokenContract.balanceOf(ACC1);
                assert.equal((oldBalance.minus(newBalance)).toString(), FEE_VAL);
            });
    
            it("fails when trying to register an already owned name", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
    
                await assertThrowsAsync(async () => {
                    await context.register(web3.sha3(NAME), FEE_VAL, ACC2);
                });
            });
    
            it("fails when trying to register and the registrar is not the root node owner", async function () {
                await rns.setSubnodeOwner(0, web3.sha3(TLD), ACC0);
    
                await assertThrowsAsync(async () => {
                    await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
                });
            });
        });
    
        describe("transfer", async function () {
            it("allows transfership of an owned name", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
                await registrar.transfer(web3.sha3(NAME), ACC2, { from: ACC1 });
                
                let node = namehash(`${NAME}.${TLD}`);
    
                let owner = await rns.owner(node);
                assert.equal(owner, ACC2, "ownership was not transfered");
            });
    
            it("fails to transfer a non owned name", async function () {
                await assertThrowsAsync(async function () {
                    await registrar.transfer(web3.sha3(NAME), ACC2, { from: ACC1 });
                });
            });
    
            it("fails to transfer to address zero", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
    
                await assertThrowsAsync(async function () {register
                    await registrar.transfer(web3.sha3(NAME), ZERO_ADDR, { from: ACC1 });
                });
            });
    
            it("fails to transfer when the registrar is no longer the owner of the tld", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
    
                await rns.setSubnodeOwner(0, web3.sha3(TLD), ACC0);
    
                await assertThrowsAsync(async () => {
                    await registrar.transfer(web3.sha3(NAME), ACC2, { from: ACC1 });
                });
            });
        });
    
        describe("state", async function () {
            it("returns Open state for non owned hashes", async function () {
                let state = await registrar.state(web3.sha3(NAME));
    
                assert.equal(state, STATES.OPEN);
            });
            it("returns Owned state for owned hashes", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
    
                let state = await registrar.state(web3.sha3(NAME));
    
                assert.equal(state, STATES.OWNED);
            });
            it("returns Expired state for expired hashes", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
    
                await increaseTime(years(1) + 1);
    
                let state = await registrar.state(web3.sha3(NAME));
    
                assert.equal(state, STATES.EXPIRED);
            });
            it("returns Renew state for hashes in renewal period", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
    
                await increaseTime(months(9) + 1);
    
                let state = await registrar.state(web3.sha3(NAME));
    
                assert.equal(state, STATES.RENEW);
            });
    
            it("returns the correct entry data for an open name", async function () {
                let entry = await registrar.entry(web3.sha3(NAME));
    
                assert.equal(entry[0], STATES.OPEN);
                assert.equal(entry[1], ZERO_ADDR);
                assert.equal(entry[2], 0); // registration date
                assert.equal(entry[3], 0); // expiration date
            });
            it("returns the correct entry data for an owned name", async function () {
                let now = getCurrentTime();
    
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
    
                let entry = await registrar.entry(web3.sha3(NAME));
    
                assert.equal(entry[0], STATES.OWNED);
                assert.equal(entry[1], ACC1);
                assert.equal(entry[2], now); // registration date
                assert.equal(entry[3], now + years(1)); // expiration date
            });
            it("returns the correct entry data for a transfered name", async function () {
                let now = getCurrentTime();
    
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
                await registrar.transfer(web3.sha3(NAME), ACC2, { from: ACC1 });
    
                let entry = await registrar.entry(web3.sha3(NAME));
    
                assert.equal(entry[0], STATES.OWNED);
                assert.equal(entry[1], ACC2);
                assert.equal(entry[2], now); // registration date
                assert.equal(entry[3], now + years(1)); // expiration date
            });
            it("returns the correct entry data for an expired name", async function () {
                let now = getCurrentTime();
    
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
    
                await increaseTime(years(1) + 1);
    
                let entry = await registrar.entry(web3.sha3(NAME));
    
                assert.equal(entry[0], STATES.EXPIRED);
                assert.equal(entry[1], ACC1);
                assert.equal(entry[2], now); // registration date
                assert.equal(entry[3], now + years(1)); // expiration date
            });
            it("returns the correct entry data for a name registered after it expired", async function () {
                let oldRegistration = getCurrentTime();
                
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
                await increaseTime(years(1) + 1);
    
                let newRegistration = getCurrentTime();
                await context.register(web3.sha3(NAME), FEE_VAL, ACC2);
    
                let entry = await registrar.entry(web3.sha3(NAME));
    
                assert.equal(entry[0], STATES.OWNED);
                assert.equal(entry[1], ACC2);
                assert.equal(entry[2], newRegistration); // registration date
                assert.equal(entry[3], newRegistration + years(1)); // expiration date
    
                assert.equal(entry[2], oldRegistration + years(1) + 1); // registration date
                assert.equal(entry[3], oldRegistration + years(2) + 1); // expiration date
            });
            it("returns the correct entry data for a name in renew period before renewal", async function () {
                let now = getCurrentTime();
    
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
    
                await increaseTime(months(9) + 1);
    
                let entry = await registrar.entry(web3.sha3(NAME));
    
                assert.equal(entry[0], STATES.RENEW);
                assert.equal(entry[1], ACC1);
                assert.equal(entry[2], now); // registration date
                assert.equal(entry[3], now + years(1)); // expiration date
            });
            it("returns the correct entry data for a name in renew period after renewal", async function () {
                let now = getCurrentTime();
    
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
    
                await increaseTime(months(9) + 1);
    
                await context.renew(web3.sha3(NAME), FEE_VAL, ACC1);

                let entry = await registrar.entry(web3.sha3(NAME));
    
                assert.equal(entry[0], STATES.OWNED);
                assert.equal(entry[1], ACC1);
                assert.equal(entry[2], now); // registration date
                assert.equal(entry[3], now + years(2)); // expiration date
            });
        });
    
        describe("expiration", async function () {
            it("allows anyone to register an expired domain", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
                
                await increaseTime(years(1) + 1);
    
                await context.register(web3.sha3(NAME), FEE_VAL, ACC2);
    
                let node = namehash(`${NAME}.${TLD}`);
    
                let owner = await rns.owner(node);
                assert.equal(owner, ACC2);
            });
    
            it("keeps expiration date when transfered", async function () {
                const registrationDate = getCurrentTime();
                
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
                
                await registrar.transfer(web3.sha3(NAME), ACC2, { from: ACC1 });
    
                let entry = await registrar.entry(web3.sha3(NAME));
    
                assert.equal(entry[3], registrationDate + years(1));
            });
        });
    
        describe("release", async function () {

            it("allows an owner to release a name", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
                
                let node = namehash(`${NAME}.${TLD}`);
    
                let oldOwner = await rns.owner(node);
                assert.equal(oldOwner, ACC1);

                await registrar.release(web3.sha3(NAME), { from: ACC1 });

                let newOwner = await rns.owner(node);
                assert.equal(newOwner, ZERO_ADDR);
                assert.notEqual(newOwner, oldOwner);

                let entry = await registrar.entry(web3.sha3(NAME));
                assert.equal(entry[1], ZERO_ADDR);
            });

            it("fails to release a name when not the owner", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);

                await assertThrowsAsync(async function () {
                    await registrar.release(web3.sha3(NAME), { from: ACC2 });
                });
            });

            it("fails to release a name when the registrar is no longer the owner of the tld", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
                                
                await rns.setSubnodeOwner(0, web3.sha3(TLD), ACC0);

                await assertThrowsAsync(async function () {
                    await registrar.release(web3.sha3(NAME), { from: ACC1 });
                });
            });
        });

        describe("renewal", async function () {
            it("doesn't allow renewal before the renewal period", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
                
                await assertThrowsAsync(async function () {
                    await context.renew(web3.sha3(NAME), FEE_VAL, ACC1);
                });
            })
    
            it("doesn't allow renewal after expiration", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
                
                await increaseTime(years(1) + 1);
    
                await assertThrowsAsync(async function () {
                    await context.renew(web3.sha3(NAME), FEE_VAL, ACC1);
                });
            })
    
            it("allows renewal for one year", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
                
                await increaseTime(months(9) + 1);
    
                await context.renew(web3.sha3(NAME), FEE_VAL, ACC1);
    
                const entry = await registrar.entry(web3.sha3(NAME));
    
                const registrationDate = parseInt(entry[2]);
                assert.equal(entry[0], STATES.OWNED);
                assert.equal(entry[3], registrationDate + years(2));
            });
    
            it("tries to renew sending less than required", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
                
                await increaseTime(months(9) + 1);
    
                await assertThrowsAsync(async function () {
                    await context.renew(web3.sha3(NAME), LOW_FEE_VAL, ACC1);
                });
            });
    
            it("transfers back the difference between the sent and renew fee values", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
                
                await increaseTime(months(9) + 1);
    
                let oldBalance = await tokenContract.balanceOf(ACC1);
    
                await context.renew(web3.sha3(NAME), HIGH_FEE_VAL, ACC1);
    
                let newBalance = await tokenContract.balanceOf(ACC1);
                assert.equal((oldBalance.minus(newBalance)).toString(), FEE_VAL);
            });
    
            it("allows an owner to renew after a transference", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
                
                await registrar.transfer(web3.sha3(NAME), ACC2, { from: ACC1 });
    
                await increaseTime(months(9) + 1);
    
                await context.renew(web3.sha3(NAME), FEE_VAL, ACC2);
    
                const entry = await registrar.entry(web3.sha3(NAME));
    
                const registrationDate = parseInt(entry[2]);
                assert.equal(entry[0], STATES.OWNED);
                assert.equal(entry[1], ACC2);
                assert.equal(entry[3], registrationDate + years(2));
            });
    
            it("allows multiple renewals over years", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
                
                for (let i = 0; i < 10; i++) {
                    await increaseTime(months(9) + 1);
                    await context.renew(web3.sha3(NAME), FEE_VAL, ACC1);
                    await increaseTime(months(3) - 1);
                }
    
                const entry = await registrar.entry(web3.sha3(NAME));
    
                let registrationDate = parseInt(entry[2]);
                assert.equal(entry[3], registrationDate + years(11));
            })
    
            it("fails when trying to transfer and the registrar is not the root node owner", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
    
                await rns.setSubnodeOwner(0, web3.sha3(TLD), ACC0);
    
                await increaseTime(months(9) + 1);
    
                await assertThrowsAsync(async () => {
                    await context.renew(web3.sha3(NAME), FEE_VAL, ACC1);
                });
            });
        });
    
        describe("transfer registrar", async function () {
            let newRegistrar;
    
            beforeEach(async function () {
                newRegistrar = await MigrationTestRegistrar.new(rns.address, namehash(TLD), registrar.address);
            });
    
            it("migrates names to a new registrar", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
    
                let entry = await registrar.entry(web3.sha3(NAME));
    
                await rns.setSubnodeOwner(0, web3.sha3(TLD), newRegistrar.address);
    
                await registrar.transferRegistrar(web3.sha3(NAME), { from: ACC1 });
    
                let owner = await newRegistrar.owner(web3.sha3(NAME));
                assert.equal(owner, entry[1]);
    
                let registrationDate = await newRegistrar.registrationDate(web3.sha3(NAME));
                assert.ok(registrationDate.eq(entry[2].toNumber()));
    
                let expirationDate = await newRegistrar.expirationDate(web3.sha3(NAME));
                assert.ok(expirationDate.eq(entry[3].toNumber()));
            });
    
            it("fails to migrate when still the rootNode owner", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
    
                await assertThrowsAsync(async function () {
                    await registrar.transferRegistrar(web3.sha3(NAME), { from: ACC1 });
                });
            })
    
            it("fails to migrate when not the name owner", async function () {
                await context.register(web3.sha3(NAME), FEE_VAL, ACC1);
    
                await rns.setSubnodeOwner(0, web3.sha3(TLD), newRegistrar.address);
    
                await assertThrowsAsync(async function () {
                    await registrar.transferRegistrar(web3.sha3(NAME), { from: ACC2 });
                });
            })
        });
    });
}