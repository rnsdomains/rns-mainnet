pragma solidity ^0.4.24;

import '../../tokens/ERC677TokenContract.sol';

/**
 * @title Deed to hold RIF tokens in exchange for ownership of a node
 *
 * @dev The deed can be controlled only by the registrar and can only send tokens back to the owner.
 */
contract TokenDeed {

    address constant RESOURCE_POOL_ADDRESS = 0xe594df49aa7a13ccdd2db3a7917312e02374f744;
    uint constant RENT_PAYMENT_TIME = 3 * 30 days; // 3 months
    uint constant VALIDITY = 365 days; // 1 year

    address public registrar;
    address public owner;
    address public previousOwner;

    uint public creationDate;
    uint public expirationDate;
	uint public tokenQuantity;

	ERC677TokenContract public tokenContract;

    bool active;

    event OwnerChanged(address newOwner);
    event DeedClosed();

    modifier onlyRegistrar {
        require(msg.sender == registrar);
        _;
    }

    modifier onlyActive {
        require(active);
        _;
    }

    /** 
     * @dev Constructor for a TokenDeed
     *
     * @param _owner The deed's owner
     * @param _tokenQuantity Amount of tokens locked in the Deed
     * @param _tokenContract Address of the contract which handles tokens
    **/
    constructor(address _owner, uint _tokenQuantity, ERC677TokenContract _tokenContract) public {
        owner = _owner;
        registrar = msg.sender;
        creationDate = now;
        expirationDate = 0;
        active = true;
        tokenQuantity = _tokenQuantity;
        tokenContract = _tokenContract;
    }

    function setOwner(address newOwner) public onlyRegistrar {
        require(newOwner != 0);
        previousOwner = owner;  // This allows contracts to check who sent them the ownership
        owner = newOwner;
        emit OwnerChanged(newOwner);
    }

    function setRegistrar(address newRegistrar) public onlyRegistrar {
        registrar = newRegistrar;
    }

    /** 
     * @dev Sets the Deed's new balance, returning the difference to the owner
     *
     * The new balance MUST be lower or equal than the current one
     *
     * @param newTokenQuantity The new balance in tokens
     * @param throwOnFailure Flag to indicate if the token transference should throw or not
    **/
    function setBalance(uint newTokenQuantity, bool throwOnFailure) public onlyRegistrar onlyActive {
        // Check if it has enough balance to set the value
        require(tokenQuantity >= newTokenQuantity);
        uint diffTokenQuantity = tokenQuantity - newTokenQuantity;
        tokenQuantity = newTokenQuantity;
        // Send the difference to the owner
        require(tokenContract.transfer(owner, diffTokenQuantity) || !throwOnFailure);
    }

    /** 
     * @dev Computes and sets the expirationDate from a given date, starting the vigency period
     *
     * @param startDate Date to calculate the expirationDate from
     * @param rentValue The value of the initial rent fee to pay in tokens
    **/
    function startExpiration(uint startDate, uint rentValue) public onlyRegistrar onlyActive {
        require(expirationDate == 0 && startDate <= now); // require expiration hasn't started
        require(rentValue <= tokenQuantity);

        expirationDate = startDate + VALIDITY;

        // transfer the fee to the resource pool address
        tokenQuantity = tokenQuantity - rentValue;
        require(tokenContract.transfer(RESOURCE_POOL_ADDRESS, rentValue));
    }

    /** 
     * @dev Pay the Deed's rent, thus extending the expirationDate and the vigency period
     *
     * Can only be called when the current date falls within the payment period (3 months)
     *
     * @param rentValue The value to pay in tokens
    **/
    function payRent(uint rentValue) public onlyRegistrar onlyActive returns(bool) {
        require(canPayRent());
        
        require(tokenContract.transfer(RESOURCE_POOL_ADDRESS, rentValue));

        expirationDate = expirationDate + VALIDITY;

        return true;
    }

    /** 
     * @dev Returns wheter the current date falls within the Deed's rent payment period
    **/
    function canPayRent() public view returns(bool) {
        return expirationDate - RENT_PAYMENT_TIME <= now && now <= expirationDate;
    }


    /** 
     * @dev Returns wether the Deed is expired or not
    **/
    function expired() public view returns(bool) {
        return 0 < expirationDate && expirationDate < now;
    }

    /**
     * @dev Close a deed and refund a specified fraction of the bid value
     *
     * @param refundRatio The amount*1/1000 to refund in tokens
     */
    function closeDeed(uint refundRatio) public onlyRegistrar onlyActive {
        refundAndDestroy(refundRatio);
    }

    /** 
     * @dev Close an expired deed. No funds are returned
    **/
    function closeExpiredDeed() public onlyActive {
        require(expired(), "Deed should be expired");
        refundAndDestroy(0);
    }

    /** 
     * @dev Internal method which handles fund returns/burning and the Deed's destruction
     *
     * @param refundRatio The amount*1/1000 to refund in tokens
    **/
    function refundAndDestroy(uint refundRatio) private onlyActive {
        require(refundRatio <= 1000);

        active = false;
        uint torefund = (1000 - refundRatio) * tokenQuantity / 1000;
        require(tokenContract.transfer(RESOURCE_POOL_ADDRESS, torefund));
        tokenQuantity -= torefund;
        emit DeedClosed();
        destroyDeed();
    }

    /**
     * @dev Close a deed and refund a specified fraction of the bid value
     */
    function destroyDeed() private {
        require(!active);

        if (tokenContract.transfer(owner, tokenQuantity)) {
            selfdestruct(RESOURCE_POOL_ADDRESS);
        }
    }

    function tokenFallback(address from, uint256 amount, bytes data) public returns (bool) {
        return true;
    }
}
