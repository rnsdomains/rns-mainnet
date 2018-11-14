pragma solidity ^0.4.24;


import "../third-party/openzeppelin/token/ERC20/StandardToken.sol";
import "../third-party/openzeppelin/token/ERC20/DetailedERC20.sol";
import "./ContractReceiver.sol";
import "./ERC677.sol";

contract ERC677TokenContract is StandardToken, ERC677, DetailedERC20 {

    constructor(address initialAccount, uint256 initialBalance) DetailedERC20("Token", "TOK", 18) public {
        balances[initialAccount] = initialBalance;
        totalSupply_ = initialBalance;
    }

    function transferAndCall(address to, uint256 value, bytes data) public returns (bool) {
        super.transfer(to, value);

        ContractReceiver(to).tokenFallback(msg.sender, value, data);

        Transfer(msg.sender, to, value, data);

        return true;
    }
}
