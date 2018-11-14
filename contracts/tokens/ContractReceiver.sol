pragma solidity ^0.4.24;

 /*
 * Contract interface that is working with ERC677 tokens
 */
 
contract ContractReceiver {
    function tokenFallback(address _from, uint _value, bytes _data) public returns(bool);
}

