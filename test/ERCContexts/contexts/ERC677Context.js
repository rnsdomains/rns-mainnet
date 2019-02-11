const BaseContext = require('./BaseContext.js');

let ERC677Context = function (tokenContract, registrar, accounts) {
    BaseContext.call(this, tokenContract, registrar, accounts);
}
ERC677Context.prototype.newBid = async function (hash, deposit, account) {
    const SIGN_NEW_BID = '0x1413151f';

    await this.transferAndCall(SIGN_NEW_BID, hash, deposit, account);
}
ERC677Context.prototype.payRent = async function (hash, deposit, account) {
    const SIGN_PAY_RENT = '0xe1ac9915';

    await this.transferAndCall(SIGN_PAY_RENT, hash, deposit, account);
}
ERC677Context.prototype.transferAndCall = async function (methodSignature, hash, deposit, account) {
    if (!account)
        account = this.accounts[0];

    const data = methodSignature + hash.toString().substring(2);

    await this.tokenContract.transferAndCall(this.registrar.address, deposit, data, { from: account, gas: 6000000, gasPrice: 1000000 });
}

ERC677Context.prototype.register = async function (hash, value, account) {
    const SIGN_REGISTER = '0x78810c57';

    await this.transferAndCall(SIGN_REGISTER, hash, value, account);
}
ERC677Context.prototype.renew = async function (hash, value, account) {
    const SIGN_RENEW = '0x9d6bb36c';

    await this.transferAndCall(SIGN_RENEW, hash, value, account);
}

module.exports = ERC677Context;