pragma solidity ^0.4.24;

import "../../common/RNS.sol";
import "../../tokens/ERC677TokenContract.sol";

/** 
    First come first serve registrar. Registers a name for the first person to claim it in exchange
    for a fixed value. Each registered name lasts one year. Owner may renew their names any time during 
    the last 3 months of said year.
 */
contract FixedFeeFIFSRegistrar {
    RNS public rns;
    bytes32 public rootNode;
    uint256 public registerFeeValue;
    uint256 public renewFeeValue;
    ERC677TokenContract public tokenContract;
    address public resourcePool;    
    mapping (bytes32 => Entry) entries;

    enum State { Open, _, Owned, __, ___, Expired, Renew }

    uint256 constant VALIDITY = 365 days;
    uint256 constant RENEW_PERIOD = 3 * 30 days;
    bytes4 constant SIGN_REGISTER = 0x78810c57;
    bytes4 constant SIGN_RENEW = 0x9d6bb36c;

    event HashRegistered(bytes32 indexed hash, address indexed owner, uint registrationDate);
    event HashRenewed(bytes32 indexed hash);
    event HashTransfered(bytes32 indexed hash, address indexed oldOwner, address indexed newOwner);
    event HashReleased(bytes32 indexed hash);

    struct Entry {
        address owner;
        uint256 registrationDate;
        uint256 expirationDate;
    }

    modifier isAvailable(bytes32 _hash) {
        State s = state(_hash);
        require(s == State.Open || s == State.Expired, "Name is not available");
        _;
    }

    modifier isRenewable(bytes32 _hash) {
        require(state(_hash) == State.Renew, "Name is not renewable");
        _;
    }

    modifier onlyOwner(bytes32 _hash) {
        require(state(_hash) == State.Owned && entries[_hash].owner == msg.sender, "Sender is not the owner");
        _;
    }

    modifier registrarOpen() {
        require(address(this) == rns.owner(rootNode), "Registrar is not open");
        _;
    }

    /**
        @dev Construct a new First-Come-First-Serve registrar which consumes tokens from an ERC677 token contract.
        Registration and renewal fees, as well as the resource pool, are configured through this constructor. 

        @param _rns The address of the RNS registry
        @param _rootNode The node managed by this registrar
        @param _registerFeeValue The fee for registering new names
        @param _resourcePool The fee for renewing a name
        @param _tokenContract The address of an ERC677 token contract
        @param _resourcePool Address where the fees are sent to
     */
    constructor (RNS _rns, bytes32 _rootNode, uint256 _registerFeeValue, uint256 _renewFeeValue, 
                 ERC677TokenContract _tokenContract, address _resourcePool) public {
        rns = _rns;
        rootNode = _rootNode;
        registerFeeValue = _registerFeeValue;
        renewFeeValue = _renewFeeValue;
        tokenContract = _tokenContract;
        resourcePool = _resourcePool;
    }

    /**
        @dev Register the hash of a given name. Requires pre-approving this registrar to use at least 1 token.

        @param _hash The hash of the label to register. For example: for 'domain.tld' it would be sha3('domain')
     */
    function register(bytes32 _hash) public {
        require(tokenContract.transferFrom(msg.sender, address(this), registerFeeValue), "Failed to transfer tokens from sender");

        innerRegister(msg.sender, registerFeeValue, _hash);
    }
    
    /**
        @dev Renew a given name, extending the ownership for 1 year. Renewal can be done only in the three months prior to expiration. Requires pre-approving this registrar to use at least 1 token.

        @param _hash The hash of the label to register. For example: for 'domain.tld' it would be sha3('domain')
     */
    function renew(bytes32 _hash) public {
        require(tokenContract.transferFrom(msg.sender, address(this), renewFeeValue), "Failed to transfer tokens from sender");

        innerRenew(msg.sender, renewFeeValue, _hash);
    }

    /** 
        @dev Handles the inner registration logic. Updates ownership of the name for a given address both in the registry and registrar after collecting the fee

        @param _address The address of the new owner
        @param _value The value in tokens sent by the registrant
        @param _hash The hash of the label to register
    */
    function innerRegister(address _address, uint256 _value, bytes32 _hash) private isAvailable(_hash) registrarOpen() {
        collectFee(_address, _value, registerFeeValue);

        Entry storage entry = entries[_hash];

        entry.owner = _address;
        entry.registrationDate = now;
        entry.expirationDate = now + VALIDITY;

        rns.setSubnodeOwner(rootNode, _hash, _address);

        emit HashRegistered(_hash, _address, entry.registrationDate);
    }

    /** 
        @dev Handles the inner logic for renewing a name. Extends the ownership by furthering the expiration date, after collecting a fee

        @param _address The address of the new owner
        @param _value The value in tokens sent by the registrant
        @param _hash The hash of the label to renew
    */
    function innerRenew(address _address, uint256 _value, bytes32 _hash) private isRenewable(_hash) registrarOpen() {
        collectFee(_address, _value, renewFeeValue);

        entries[_hash].expirationDate += VALIDITY;

        emit HashRenewed(_hash);
    }

    /**
        @dev Transfers ownership to a new owner

        @param _hash The hash of the label to transfer
        @param _newOwner The new owner of the name
     */
    function transfer(bytes32 _hash, address _newOwner) public onlyOwner(_hash) registrarOpen() {
        require(_newOwner != 0, "Owner is zero");
        
        entries[_hash].owner = _newOwner;

        rns.setSubnodeOwner(rootNode, _hash, _newOwner);

        emit HashTransfered(_hash, msg.sender, _newOwner);
    }

    /**
        @dev Releases a name, forefeiting ownership of it and clearing its information in the registrar and registry

        @param _hash The hash of the label to be released
     */
    function release(bytes32 _hash) public onlyOwner(_hash) registrarOpen() {
        rns.setSubnodeOwner(rootNode, _hash, 0);

        clearEntry(_hash);

        emit HashReleased(_hash);
    }

    /**
        @dev Migrates the name and its ownership to a new registrar

        @param _hash The hash of the label to transfer
     */
    function transferRegistrar(bytes32 _hash) public onlyOwner(_hash) {
        address newRegistrar = rns.owner(rootNode);
        require(newRegistrar != address(this), "Registrar still owns the root node");

        Entry storage entry = entries[_hash];

        FixedFeeFIFSRegistrar(newRegistrar).acceptRegistrarTransfer(_hash, entry.owner, entry.registrationDate, entry.expirationDate);

        clearEntry(_hash);
    }
    function acceptRegistrarTransfer(bytes32 _hash, address _owner, uint256 _registrationDate, uint256 _expirationDate) public {
        _hash; _owner; _registrationDate; _expirationDate;
    }

    /** 
        @dev Clears the entry for a given hash

        @param _hash The hash of a label
     */
    function clearEntry(bytes32 _hash) private {
        Entry storage entry = entries[_hash];

        entry.owner = address(0);
        entry.registrationDate = 0;
        entry.expirationDate = 0;
    }

    /**
        @dev Returns the state of a given name

        @param _hash The hash of the label to query the state for
     */
    function state(bytes32 _hash) public view returns (State) {
        Entry storage entry = entries[_hash];

        if (entry.expirationDate != 0 && entry.expirationDate < now) {
            return State.Expired;
        } else {
            if (entry.owner != 0) {
                if ((entry.expirationDate - RENEW_PERIOD) <= now && now < entry.expirationDate) { 
                    return State.Renew;
                } else {
                    return State.Owned;
                }
            } else {
                return State.Open;
            }
        }
    }

    /**
        @dev Returns information about a given name. I.E:
            - The current state
            - The current owner
            - The registration date
            - The expiration date

        @param _hash The hash of the label to query the information for
     */
    function entry(bytes32 _hash) public view returns (State, address, uint256, uint256) {
        Entry storage entry = entries[_hash];

        return (state(_hash), entry.owner, entry.registrationDate, entry.expirationDate);
    }

    /**
        @dev Handles the fee collection logic. Given a sender, an amount and a fee value, substracts the fee from the amount, transferring it to the resource pool and refunding the difference to the sender

        @param _sender The sender address the funds will be collected from and refunded to
        @param _amount The amount sent by the sender
        @param _fee The fee value to collect
     */
    function collectFee(address _sender, uint256 _amount, uint256 _fee) private {
        require(_amount >= _fee, "Amount less than fee");

        uint256 refund = _amount - _fee;
        
        require(tokenContract.transfer(resourcePool, _fee), "Failed to fee");
        require(tokenContract.transfer(_sender, refund), "Failed to refund difference");
    }

    /**
        @dev Fallback function used when interacting with an ERC677 token contract.
        Supported methods:
            - innerRegister, through the signature 0x78810c57
            - innerRenew, through the signature 0x9d6bb36c

        @param _from The address which sent the tokens
        @param _value The amount of tokens sent
        @param _data Byte array with information specifying which function to call and the parameters used for the invocation
     */
    function tokenFallback(address _from, uint256 _value, bytes _data) public returns (bool) {
        if (_data.length < 4) revert();

        require(msg.sender == address(tokenContract), "Sender is not token contract");

        bytes4 signature = bytes4(uint32(_data[3]) + (uint32(_data[2]) << 8) + (uint32(_data[1]) << 16) + (uint32(_data[0]) << 24));

        bytes32 hash;
        if (signature == SIGN_REGISTER) {
            hash = bytesToBytes32(_data, 4);

            innerRegister(_from, _value, hash);
        } else if (signature == SIGN_RENEW) {
            hash = bytesToBytes32(_data, 4);

            innerRenew(_from, _value, hash);
        } else {
            revert();
        }

        return true;
    }

    /** 
     * @dev Given a byte array and a given offset, extract the following 32 bytes into an array
     *
     * from https://ethereum.stackexchange.com/questions/7702/how-to-convert-byte-array-to-bytes32-in-solidity
    **/
    function bytesToBytes32(bytes _b, uint _offset) private pure returns (bytes32) {
        bytes32 out;

        for (uint i = 0; i < 32; i++) {
            out |= bytes32(_b[_offset + i] & 0xFF) >> (i * 8);
        }

        return out;
    }
}