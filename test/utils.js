const assert = require('assert');
const fs = require('fs');
const namehash = require('eth-ens-namehash');
const BigNumber = require('bignumber.js');

// from https://ethereum.stackexchange.com/questions/11444/web3-js-with-promisified-api

const promisify = (inner) =>
  new Promise((resolve, reject) =>
    inner((err, res) => {
      if (err) { reject(err) }

      resolve(res);
    })
);

function minutes(numberOfMinutes) {
	return numberOfMinutes * 60;
}

// days in secs
function days(numberOfDays) {
	return numberOfDays * 24 * 60 * 60;
}

function months(numberOfMonths) {
	return numberOfMonths * days(31);
}

function years(numberOfYears) {
	return numberOfYears * days(365);
}

function dateToSec(date) {
	let milis = date instanceof Date ? date.getTime() : date;
	return Math.trunc(milis / 1000);
}

async function resetNode() {
	try {
		await promisify(cb => web3.currentProvider.sendAsync( { jsonrpc: "2.0", "method": "evm_reset", params: [] }, cb));
	}
	catch (ex) {
		
	}
}

async function increaseTime(time) {
	try {
		await promisify(cb => web3.currentProvider.sendAsync( { jsonrpc: "2.0", "method": "evm_increaseTime", params: [time] }, cb));
	}
	catch (ex) {
		
	}
}

async function assertThrowsAsync(prom) {
	let auxCallback = () => {};
	try {
		await prom();
	} catch (ex) {
		auxCallback = () => { throw ex; }
	} finally {
		assert.throws(auxCallback, Error);
	}
}

function isVMException(ex) {
	const expectedMsg = "VM Exception while processing transaction: revert";

	const msg = typeof ex === "string" ? ex : ex.message;

	return msg.indexOf(expectedMsg) != -1;
}

function toTokens(amount) {
	// the realtionship between tokens and their minimal fraction
	// is the same as sbtc to wei (1 token = 1e18 minimal units)
	return new BigNumber(amount).times(new BigNumber('1e18')).toNumber();
}

module.exports = {
	promisify: promisify,
	minutes: minutes,
	days: days,
	months: months,
	years: years,
	dateToSec: dateToSec,
	resetNode: resetNode,
	increaseTime: increaseTime,
	node: namehash.hash('eth'),
	assertThrowsAsync: assertThrowsAsync,
	isVMException: isVMException,
	toTokens: toTokens
};