pragma solidity ^0.4.24;

import './AbstractRNS.sol';

/**
 * A simple resolver anyone can use; only allows the owner of a node to set its
 * address.
 */
contract PublicResolver {
    AbstractRNS rns;
    mapping(bytes32=>address) addresses;
    mapping(bytes32=>bytes32) hashes;

    modifier only_owner(bytes32 node) {
        require(rns.owner(node) == msg.sender);
        _;
    }

    /**
     * Constructor.
     * @param rnsAddr The RNS registrar contract.
     */
    constructor(AbstractRNS rnsAddr) public {
        rns = rnsAddr;
    }

    /**
     * Fallback function.
     */
    function() public {
        revert();
    }

    /**
     * Returns true if the specified node has the specified record type.
     * @param node The RNS node to query.
     * @param kind The record type name, as specified in EIP137.
     * @return True if this resolver has a record of the provided type on the
     *         provided node.
     */
    function has(bytes32 node, bytes32 kind) public view returns (bool) {
        return  (kind == "addr" && addresses[node] != 0) || 
        (kind == "hash" && hashes[node] != 0);
    }

    /**
     * Returns true if the resolver implements the interface specified by the provided hash.
     * @param interfaceID The ID of the interface to check for.
     * @return True if the contract implements the requested interface.
     */
    function supportsInterface(bytes4 interfaceID) public pure returns (bool) {
        return interfaceID == 0x3b3b57de || interfaceID == 0xd8389dc5;
    }

    /**
     * Returns the address associated with an RNS node.
     * @param node The RNS node to query.
     * @return The associated address.
     */
    function addr(bytes32 node) public view returns (address) {
        return addresses[node];
    }

    /**
     * Sets the address associated with an RNS node.
     * May only be called by the owner of that node in the RNS registry.
     * @param node The node to update.
     * @param addrValue The address to set.
     */
    function setAddr(bytes32 node, address addrValue) public only_owner(node) {
        addresses[node] = addrValue;
    }

    /**
     * Returns the content hash associated with an RNS node.
     * Note that this resource type is not standardized, and will likely change
     * in future to a resource type based on multihash.
     * @param node The RNS node to query.
     * @return The associated content hash.
     */
    function content(bytes32 node) public view returns (bytes32) {
        return hashes[node];
    }

    /**
     * Sets the content hash associated with an RNS node.
     * May only be called by the owner of that node in the RNS registry.
     * Note that this resource type is not standardized, and will likely change
     * in future to a resource type based on multihash.
     * @param node The node to update.
     * @param hash The content hash to set
     */
    function setContent(bytes32 node, bytes32 hash) public only_owner(node) {
        hashes[node] = hash;
    }
}
