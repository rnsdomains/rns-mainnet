pragma solidity ^0.4.24;

import '../../common/AbstractRNS.sol';

/**
 * A registrar that allocates subdomains to the first person to claim them, but
 * expires registrations a fixed period after they're initially claimed.
 */
contract TestRegistrar {
    uint constant registrationPeriod = 4 weeks;

    AbstractRNS public rns;
    bytes32 public rootNode;
    mapping(bytes32=>uint) public expiryTimes;

    /**
     * Constructor.
     * @param rnsAddr The address of the RNS registry.
     * @param node The node that this registrar administers.
     */
    constructor(AbstractRNS rnsAddr, bytes32 node) public {
        rns = rnsAddr;
        rootNode = node;
    }

    /**
     * Register a name that's not currently registered
     * @param subnode The hash of the label to register.
     * @param owner The address of the new owner.
     */
    function register(bytes32 subnode, address owner) public {
        require(expiryTimes[subnode] < now);

        expiryTimes[subnode] = now + registrationPeriod;
        rns.setSubnodeOwner(rootNode, subnode, owner);
    }
}