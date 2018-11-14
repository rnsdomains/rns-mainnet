pragma solidity ^0.4.24;

import './AbstractRNS.sol';

/**
 * The RNS registry contract.
 */
contract RNS is AbstractRNS {
    struct Record {
        address owner;
        address resolver;
        uint64 ttl;
    }

    mapping(bytes32=>Record) records;

    // Permits modifications only by the owner of the specified node.
    modifier only_owner(bytes32 node) {
        require(records[node].owner == msg.sender);
        _;
    }

    /**
     * Constructs a new RNS registrar.
     */
    constructor() public {
        records[bytes32(0)].owner = msg.sender;
    }

    /**
     * Returns the address that owns the specified node.
     */
    function owner(bytes32 node) public view returns (address) {
        return records[node].owner;
    }

    /**
     * Returns the address of the resolver for the specified node.
     */
    function resolver(bytes32 node) public view returns (address) {
        return records[node].resolver;
    }

    /**
     * Returns the TTL of a node, and any records associated with it.
     */
    function ttl(bytes32 node) public view returns (uint64) {
        return records[node].ttl;
    }

    /**
     * Transfers ownership of a node to a new address. May only be called by the current
     * owner of the node.
     * @param node The node to transfer ownership of.
     * @param ownerAddress The address of the new owner.
     */
    function setOwner(bytes32 node, address ownerAddress) public only_owner(node) {
        emit Transfer(node, ownerAddress);
        records[node].owner = ownerAddress;
    }

    /**
     * Transfers ownership of a subnode keccak256(node, label) to a new address. May only be
     * called by the owner of the parent node.
     * @param node The parent node.
     * @param label The hash of the label specifying the subnode.
     * @param ownerAddress The address of the new owner.
     */
    function setSubnodeOwner(bytes32 node, bytes32 label, address ownerAddress) public only_owner(node) {
        bytes32 subnode = keccak256(abi.encodePacked(node, label));
        emit NewOwner(node, label, ownerAddress);
        records[subnode].owner = ownerAddress;

        emit NewResolver(subnode, records[node].resolver);
        records[subnode].resolver = records[node].resolver;
    }

    /**
     * Sets the resolver address for the specified node.
     * @param node The node to update.
     * @param resolverAddress The address of the resolver.
     */
    function setResolver(bytes32 node, address resolverAddress) public only_owner(node) {
        emit NewResolver(node, resolverAddress);
        records[node].resolver = resolverAddress;
    }

    /**
     * Sets the TTL for the specified node.
     * @param node The node to update.
     * @param ttlValue The TTL in seconds.
     */
    function setTTL(bytes32 node, uint64 ttlValue) public only_owner(node) {
        emit NewTTL(node, ttlValue);
        records[node].ttl = ttlValue;
    }

    /**
     * Sets the default resolver for new nodes
     * @param resolver The address of the new defaultResolver
     */
    function setDefaultResolver(address resolver) public only_owner(0) {
        records[bytes32(0)].resolver = resolver;
    }
}
