pragma solidity ^0.4.24;

import '../../common/AbstractRNS.sol';

contract MigrationTestRegistrar {
    AbstractRNS public rns;
    bytes32 public rootNode;
    address public oldRegistrar;

    mapping (bytes32 => Entry) entries;

    struct Entry {
        address owner;
        uint256 registrationDate;
        uint256 expirationDate;
    }

    constructor(AbstractRNS _rns, bytes32 _root, address _oldRegistrar) public {
        rns = _rns;
        rootNode = _root;
        oldRegistrar = _oldRegistrar;
    }

    function acceptRegistrarTransfer(bytes32 _hash, address _owner, uint256 _registrationDate, uint256 _expirationDate) public {
        require(msg.sender == oldRegistrar);

        entries[_hash].owner = _owner;
        entries[_hash].registrationDate = _registrationDate;
        entries[_hash].expirationDate = _expirationDate;
    }

    function owner(bytes32 _hash) public view returns (address) {
        return entries[_hash].owner;
    }
    function registrationDate(bytes32 _hash) public view returns (uint256) {
        return entries[_hash].registrationDate;
    }
    function expirationDate(bytes32 _hash) public view returns (uint256) {
        return entries[_hash].expirationDate;
    }
}