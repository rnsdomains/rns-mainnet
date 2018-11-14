
// See https://github.com/ethereum/EIPs/issues/677

pragma solidity ^0.4.24;

 /* ERC677 contract interface */
 
contract ERC677 {
    function transferAndCall(address to, uint256 value, bytes data) public returns (bool ok);

    event Transfer(address indexed from, address indexed to, uint256 value, bytes data);
}
