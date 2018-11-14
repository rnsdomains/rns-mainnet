pragma solidity ^0.4.24;

contract AbstractRNS {
    function owner(bytes32 node) public view returns(address);
    function resolver(bytes32 node) public view returns(address);
    function ttl(bytes32 node) public view returns(uint64);
    function setOwner(bytes32 node, address ownerAddress) public;
    function setSubnodeOwner(bytes32 node, bytes32 label, address ownerAddress) public;
    function setResolver(bytes32 node, address resolverAddress) public;
    function setTTL(bytes32 node, uint64 ttlValue) public;

    // Logged when the owner of a node assigns a new owner to a subnode.
    event NewOwner(bytes32 indexed node, bytes32 indexed label, address ownerAddress);

    // Logged when the owner of a node transfers ownership to a new account.
    event Transfer(bytes32 indexed node, address ownerAddress);

    // Logged when the resolver for a node changes.
    event NewResolver(bytes32 indexed node, address resolverAddress);

    // Logged when the TTL of a node changes
    event NewTTL(bytes32 indexed node, uint64 ttlValue);
}
