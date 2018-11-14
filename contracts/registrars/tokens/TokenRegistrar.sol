pragma solidity ^0.4.24;


/*

Temporary Hash Registrar
========================

This is a simplified version of a hash registrar. It is purporsefully limited:
names cannot be six letters or shorter, new auctions will stop after 4 years.

The plan is to test the basic features and then move to a new contract in at most
2 years, when some sort of renewal mechanism will be enabled.

Refund schedule
===============

Case A: Reveal Period
------------------------------------------------------------------------------------
| (I) Auction winner | Funds are locked in Deed. 80% are returned on Deed release  |
------------------------------------------------------------------------------------
| (II) Auction losser | 100% refund over the losing bid                            |
------------------------------------------------------------------------------------

Case B: Late-Reveal Period (2 weeks after auction finish)
---------------------------------------------------------------------------------------------------
| (I) Bid that would have won                 | 20% taken as fee                                  |
---------------------------------------------------------------------------------------------------
| (II) Bid that would have affected 2nd place | Difference with the actual 2nd place taken as fee |
---------------------------------------------------------------------------------------------------
| (III) Otherwise                             | 0.5% taken as fee                                 |
---------------------------------------------------------------------------------------------------

Case C: Any bid unsealed beyond the Late-Reveal period won't be refunded
*/


import './TokenDeed.sol';
import '../../common/RNS.sol';
import '../../tokens/ERC677TokenContract.sol';

/**
 * @title TokenRegistrar
 * @dev The registrar handles the auction process for each subnode of the node it owns.
 */
contract TokenRegistrar {
    using SafeMath for uint256;

    RNS public rns;
    bytes32 public rootNode;
	ERC677TokenContract public tokenContract;

    mapping (bytes32 => Entry) _entries;
    mapping (address => mapping (bytes32 => TokenDeed)) public sealedBids;
    
    enum Mode { Open, Auction, Owned, Forbidden, Reveal }

    bytes4 constant SIGN_NEW_BID = 0x1413151f;  // sha3('newBidWithToken(address,uint256,bytes32)')
    bytes4 constant SIGN_PAY_RENT = 0xe1ac9915; // sha3('payRentWithToken(address,uint256,bytes32)')
    uint32 constant TOTAL_AUCTION_LENGTH = 5 days;
    uint32 constant REVEAL_PERIOD = 48 hours;
    uint32 constant LATE_UNSEAL_PERIOD = 15 days;
    uint constant RELEASE_FEE_PER_MIL = 200;    // 200 of 1000 = 20%
    uint constant MIN_TOKEN_QUANTITY = 1 * 10**18;  // 1 token
    uint constant RENT_VALUE = 1 * 10**18;  // 1 token
    
    event AuctionStarted(bytes32 indexed hash, uint registrationDate);
    event NewBid(bytes32 indexed hash, address indexed bidder, uint deposit);
    event BidRevealed(bytes32 indexed hash, address indexed owner, uint value, uint8 status);
    event HashRegistered(bytes32 indexed hash, address indexed owner, uint value, uint registrationDate);
    event HashReleased(bytes32 indexed hash, uint value);

    struct Entry {
        TokenDeed deed;
        uint registrationDate;
        uint value;
        uint highestBid;
    }

    modifier inState(bytes32 _hash, Mode _state) {
        require(state(_hash) == _state);
        _;
    }

    modifier onlyOwner(bytes32 _hash) {
        require(state(_hash) == Mode.Owned && msg.sender == _entries[_hash].deed.owner());
        _;
    }

    modifier registryOpen() {
        require(rns.owner(rootNode) == address(this));
        _;
    }

    /**
     * @dev Constructs a new Registrar, with the provided address as the owner of the root node.
     *
     * @param _rns The address of the RNS
     * @param _rootNode The hash of the rootnode.
     * @param _tokenAddr The ERC677 contract address to handle tokens
     */
    constructor(RNS _rns, bytes32 _rootNode, ERC677TokenContract _tokenAddr) public {
        rns = _rns;
        rootNode = _rootNode;
        tokenContract = _tokenAddr;
    }

    /**
     * @dev Start an auction for an available hash
     *
     * @param _hash The hash to start an auction on
     */
    function startAuction(bytes32 _hash) public registryOpen() {
        Mode mode = state(_hash);
        if (mode == Mode.Auction) return;
        require(mode == Mode.Open);

        Entry storage newAuction = _entries[_hash];
        newAuction.registrationDate = now + TOTAL_AUCTION_LENGTH;
        newAuction.value = 0;
        newAuction.highestBid = 0;
        newAuction.deed = TokenDeed(0);

        emit AuctionStarted(_hash, newAuction.registrationDate);
    }

    /**
     * @dev Start multiple auctions for better anonymity
     *
     * Anyone can start an auction by sending an array of hashes that they want to bid for.
     * Arrays are sent so that someone can open up an auction for X dummy hashes when they
     * are only really interested in bidding for one. This will increase the cost for an
     * attacker to simply bid blindly on all new auctions. Dummy auctions that are
     * open but not bid on are closed after a week.
     *
     * @param _hashes An array of hashes, at least one of which you presumably want to bid on
     */
    function startAuctions(bytes32[] _hashes) public {
        for (uint i = 0; i < _hashes.length; i ++) {
            startAuction(_hashes[i]);
        }
    }

    /**
     * @dev Submit a new sealed bid on a desired hash in a blind auction
     *
     * Bids are sent by sending a message to the main contract with a hash and an amount. The hash
     * contains information about the bid, including the bidded hash, the bid amount, and a random
     * salt. Bids are not tied to any one auction until they are revealed. The value of the bid
     * itself can be masqueraded by sending more than the value of your actual bid. This is
     * followed by a 48h reveal period. For bids revealed after this period, a percentage (defined in the late unsealing 
     * Refund schedule) will be sent to a special resource pool address.
     * Since this is an auction, it is expected that most public hashes, like known domains and common dictionary
     * words, will have multiple bidders pushing the price up.
     *
     * This method requires the sender to approve the Registrar to use the specified tokenQuantity in the ERC677 contract.
     * Otherwise it can be done through the tokenFallback after a transfer with the corresponding parameters
     *
     * @param _sealedBid A sealedBid, created by the shaBid function
     * @param _tokenQuantity token quantity to bid
     */
    function newBid(bytes32 _sealedBid, uint _tokenQuantity) public {
        require(tokenContract.transferFrom(msg.sender, address(this), _tokenQuantity));

        newBidAfterTransfer(msg.sender, _tokenQuantity, _sealedBid);
    }

    /**  
     * @dev Method to be called through a dynamic invocation from an ERC677 token contract
     *
     * @param _from Address sending the tokens as well as submitting the bid
     * @param _tokenQuantity Amount in tokens received throuh the transference
     * @param _sealedBid Sealed bid, created through the shaBid function
    **/
    function newBidWithToken(address _from, uint _tokenQuantity, bytes32 _sealedBid) public {
        require(msg.sender == address(tokenContract));
        newBidAfterTransfer(_from, _tokenQuantity, _sealedBid);
    }

    /** 
     * @dev Internal method which handles the new bidding logic
     *
     * @param _from Address sending the tokens as well as submitting the bid
     * @param _tokenQuantity Amount in tokens received through the transference. To be used to mask the actual bidded value
     * @param _sealedBid Sealed bid, created through the shaBid function
    **/
    function newBidAfterTransfer(address _from, uint _tokenQuantity, bytes32 _sealedBid) private {
        require(address(sealedBids[_from][_sealedBid]) == 0x0);

        // Creates a new hash contract with the owner
        TokenDeed createdBid = new TokenDeed(_from, _tokenQuantity, tokenContract);
        require(tokenContract.transfer(createdBid, _tokenQuantity));
        sealedBids[_from][_sealedBid] = createdBid;
		
        emit NewBid(_sealedBid, _from, _tokenQuantity);
    }

    /**
     * @dev Start a set of auctions and bid on one of them
     *
     * This method functions identically to calling `startAuctions` followed by `newBid`,
     * but all in one transaction.
     *
     * @param _hashes A list of hashes to start auctions on.
     * @param _sealedBid A sealed bid for one of the auctions.
     * @param _tokenQuantity Amount of tokens to mask the bid with.
     */
    function startAuctionsAndBid(bytes32[] _hashes, bytes32 _sealedBid, uint _tokenQuantity) public payable {
        startAuctions(_hashes);
        newBid(_sealedBid, _tokenQuantity);
    }

    /**
     * @dev Submit the properties of a bid to reveal them
     *
     * @param _hash The node in the sealedBid
     * @param _value The bid amount in the sealedBid
     * @param _salt The sale in the sealedBid
     */
    function unsealBid(bytes32 _hash, uint _value, bytes32 _salt) public {
        bytes32 seal = shaBid(_hash, msg.sender, _value, _salt);
        TokenDeed bid = sealedBids[msg.sender][seal];
        require(address(bid) != 0);

        sealedBids[msg.sender][seal] = TokenDeed(0);
        Entry storage h = _entries[_hash];
        uint value = min(_value, bid.tokenQuantity());
        bid.setBalance(value, true);

        Mode auctionState = state(_hash);

        if (auctionState == Mode.Owned) {
            // By this point the auction has ended. The refund values are defined in the above Refund Schedule

            uint256 refundRatio = 995; // See: Case B)III

            if (h.registrationDate + LATE_UNSEAL_PERIOD < now) {
                refundRatio = 0; // See: Case C
            } else {
                if (value > h.highestBid) {
                    refundRatio = 800; // See: Case B)I
                } else if (value > h.value) {
                    // See: Case B)II
                    // Compute percentage corresponding to the difference between the actual 2nd place (h.value)
                    // and the late unsealed bid (value)
                    refundRatio = h.value.mul(1000).div(value);
                }
            }

            bid.closeDeed(refundRatio);
            emit BidRevealed(_hash, msg.sender, value, 1);
        } else if (auctionState != Mode.Reveal) {
            // invalid phase for unsealing
            revert();
        } else if (value < MIN_TOKEN_QUANTITY || bid.creationDate() > h.registrationDate - REVEAL_PERIOD) {
            // Bid below the minimum or too late (created in the reveal period)
            bid.closeDeed(1000);
            emit BidRevealed(_hash, msg.sender, value, 0);
        } else if (value > h.highestBid) {
            // New winner
            // Cancel the other bid
            if (address(h.deed) != 0) {
                TokenDeed previousWinner = h.deed;
                previousWinner.closeDeed(1000);
            }

            // Set new winner
            // Per the rules of a vickery auction, the value becomes the previous highestBid
            h.value = h.highestBid;  // will be zero if there's only 1 bidder
            h.highestBid = value;
            h.deed = bid;
            emit BidRevealed(_hash, msg.sender, value, 2);
        } else if (value > h.value) {
            // Not winner, but affects second place
            h.value = value;
            bid.closeDeed(1000);
            emit BidRevealed(_hash, msg.sender, value, 3);
        } else {
            // Bid doesn't affect auction
            bid.closeDeed(1000);
            emit BidRevealed(_hash, msg.sender, value, 4);
        }
    }

    /**
     * @dev Finalize an auction after the registration date has passed
     *
     * Updates the Registry to reflect the new node owner. Starts the winning Deed's expiration period.
     *
     * @param _hash The hash of the name the auction is for
     */
    function finalizeAuction(bytes32 _hash) public onlyOwner(_hash) {
        Entry storage h = _entries[_hash];
        
        // Handles the case when there's only a single bidder (h.value is zero)
        h.value = max(h.value, MIN_TOKEN_QUANTITY);
        h.deed.setBalance(h.value, true);
        h.deed.startExpiration(h.registrationDate, RENT_VALUE);

        trySetSubnodeOwner(_hash, h.deed.owner());
        emit HashRegistered(_hash, h.deed.owner(), h.value, h.registrationDate);
    }

    /**
     * @dev The owner of a domain may transfer it to someone else at any time.
     *
     * @param _hash The node to transfer
     * @param _newOwner The address to transfer ownership to
     */
    function transfer(bytes32 _hash, address _newOwner) public onlyOwner(_hash) {
        require(_newOwner != 0);

        Entry storage h = _entries[_hash];
        h.deed.setOwner(_newOwner);
        trySetSubnodeOwner(_hash, _newOwner);
    }

    /**
     * @dev After some time, or if we're no longer the registrar, the owner can release
     *      the name and get a part of their tokens back.
     *
     * The allowed release period is within the rent payment period, which starts 3 months before the expiration date
     *
     * @param _hash The node to release
     */
    function releaseDeed(bytes32 _hash) public onlyOwner(_hash) {
        Entry storage h = _entries[_hash];
        TokenDeed deedContract = h.deed;

        require(now < deedContract.expirationDate() || rns.owner(rootNode) != address(this));

        h.value = 0;
        h.highestBid = 0;
        h.deed = TokenDeed(0);

        _tryEraseSingleNode(_hash);

        // return funds after deducting a fee and close the deed
        deedContract.closeDeed(1000 - RELEASE_FEE_PER_MIL);

        emit HashReleased(_hash, h.value);        
    }

    /**
     * @dev Allows anyone to delete the owner and resolver records for a (subdomain of) a
     *      name that is not currently owned in the registrar. If passing, eg, 'foo.bar.rsk',
     *      the owner and resolver fields on 'foo.bar.rsk' and 'bar.rsk' will all be cleared.
     *
     * @param _labels A series of label hashes identifying the name to zero out, rooted at the
     *        registrar's root. Must contain at least one element. For instance, to zero 
     *        'foo.bar.rsk' on a registrar that owns '.rsk', pass an array containing
     *        [keccak256('foo'), keccak256('bar')].
     */
    function eraseNode(bytes32[] _labels) public {
        require(_labels.length != 0);
        require(state(_labels[_labels.length - 1]) != Mode.Owned);

        _eraseNodeHierarchy(_labels.length - 1, _labels, rootNode);
    }

    /**
     * @dev Transfers the deed to the current registrar, if different from this one.
     *
     * Used during the upgrade process to a permanent registrar.
     *
     * @param _hash The name hash to transfer.
     */
    function transferRegistrars(bytes32 _hash) public onlyOwner(_hash) {
        address registrar = rns.owner(rootNode);
        require(registrar != address(this));

        // Migrate the deed
        Entry storage h = _entries[_hash];
        h.deed.setRegistrar(registrar);

        // Call the new registrar to accept the transfer
        TokenRegistrar(registrar).acceptRegistrarTransfer(_hash, h.deed, h.registrationDate);

        // Zero out the Entry
        h.deed = TokenDeed(0);
        h.registrationDate = 0;
        h.value = 0;
        h.highestBid = 0;
    }

    /**
     * @dev Pay the yearly rent for a name
     *
     * Names have a vigency of 1 year after the registration date. Said expiry date is reflected through the associated Deed 
     * contract. Owners have a period of 3 months before the expiryDate to pay the rent and extend their ownership for 1 year
     *
     * @param _hash The hash of the name to pay the rent for
     */
    function payRent(bytes32 _hash) public {
        require(tokenContract.transferFrom(msg.sender, address(this), RENT_VALUE));
        payRentAfterTransfer(_hash);
    }

    /**  
     * @dev Method to be called through a dynamic invocation from an ERC677 token contract
     *
     * @param _from Address sending the tokens as well as submitting the bid
     * @param _tokenQuantity Amount in tokens received throuh the transference
     * @param _hash Hash of the name to pay the rent for
    **/
    function payRentWithToken(address _from, uint _tokenQuantity, bytes32 _hash) public {
        require(_tokenQuantity == RENT_VALUE);
        require(msg.sender == address(tokenContract));
        payRentAfterTransfer(_hash);
    }

    /** 
     * @dev Internal method which handles the rent payment logic
     *
     * @param _hash Hash of the name to pay the rent for
    **/
    function payRentAfterTransfer(bytes32 _hash) private {
        require(state(_hash) == Mode.Owned);

        Entry storage h = _entries[_hash];

        require(address(h.deed) != 0);

        require(tokenContract.transfer(h.deed, RENT_VALUE));
        require(h.deed.payRent(RENT_VALUE));
    }

    /**
     * @dev Accepts a transfer from a previous registrar; stubbed out here since there
     *      is no previous registrar implementing this interface.
     *
     * @param _hash The sha3 hash of the label to transfer.
     * @param _deed The TokenDeed object for the name being transferred in.
     * @param _registrationDate The date at which the name was originally registered.
     */
    function acceptRegistrarTransfer(bytes32 _hash, TokenDeed _deed, uint _registrationDate) public pure {
        _hash; _deed; _registrationDate; // Don't warn about unused variables
    }

    // State transitions for names:
    //   Open -> Auction (startAuction)
    //   Auction -> Reveal
    //   Reveal -> Owned
    //   Reveal -> Open (if nobody bid)
    //   Owned -> Open (releaseDeed or the deed has expired)
    function state(bytes32 _hash) public view returns (Mode) {
        Entry storage entry = _entries[_hash];

        if (now < entry.registrationDate) {
            if (now < entry.registrationDate - REVEAL_PERIOD) {
                return Mode.Auction;
            } else {
                return Mode.Reveal;
            }
        } else {
            // there may not be any bid (not yet auctioned) or there is and it may have already expired (Expired)
            if (entry.highestBid == 0 || entry.deed.expired()) {
                return Mode.Open;
            } else {
                return Mode.Owned;
            }
        }
    }

    /** 
     * @dev Returns information related to a certain name
     *
     * @param _hash Hash of the name to query about
    **/
    function entries(bytes32 _hash) public view returns (Mode, address, uint, uint, uint) {
        Entry storage h = _entries[_hash];
        return (state(_hash), h.deed, h.registrationDate, h.value, h.highestBid);
    }

    /**
     * @dev Hash the values required for a secret bid
     *
     * @param _hash The node corresponding to the desired namehash
     * @param _value The bid amount in tokens
     * @param _salt A random value to ensure secrecy of the bid
     * @return The hash of the bid values
     */
    function shaBid(bytes32 _hash, address _owner, uint _value, bytes32 _salt) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(_hash, _owner, _value, _salt));
    }

    function _tryEraseSingleNode(bytes32 _label) internal {
        if (rns.owner(rootNode) == address(this)) {
            rns.setSubnodeOwner(rootNode, _label, address(this));
            bytes32 node = keccak256(abi.encodePacked(rootNode, _label));
            rns.setResolver(node, 0);
            rns.setOwner(node, 0);
        }
    }

    function _eraseNodeHierarchy(uint _idx, bytes32[] _labels, bytes32 _node) internal {
        // Take ownership of the node
        rns.setSubnodeOwner(_node, _labels[_idx], address(this));
        _node = keccak256(abi.encodePacked(_node, _labels[_idx]));

        // Recurse if there are more labels
        if (_idx > 0) {
            _eraseNodeHierarchy(_idx - 1, _labels, _node);
        }

        // Erase the resolver and owner records
        rns.setResolver(_node, 0);
        rns.setOwner(_node, 0);
    }

    /**
     * @dev Assign the owner in RNS, if we're still the registrar
     *
     * @param _hash hash to change owner
     * @param _newOwner new owner to transfer to
     */
    function trySetSubnodeOwner(bytes32 _hash, address _newOwner) internal {
        if (rns.owner(rootNode) == address(this))
            rns.setSubnodeOwner(rootNode, _hash, _newOwner);
    }

    /**
     * @dev Returns the maximum of two unsigned integers
     *
     * @param a A number to compare
     * @param b A number to compare
     * @return The maximum of two unsigned integers
     */
    function max(uint a, uint b) internal pure returns (uint) {
        if (a > b)
            return a;
        else
            return b;
    }

    /**
     * @dev Returns the minimum of two unsigned integers
     *
     * @param a A number to compare
     * @param b A number to compare
     * @return The minimum of two unsigned integers
     */
    function min(uint a, uint b) internal pure returns (uint) {
        if (a < b)
            return a;
        else
            return b;
    }

    /** 
     * @dev Fallback function to be called when the contract receives a transference through an ERC677 contract
     *
     * Functions supported:
     * - newBidWithToken (signature 0x1413151f) with a 32 byte parameter (sealedBid to submit)
     * - payRentWithToken (signature 0xe1ac9915) with a 32 byte parameter (hash of the name to pay the rent for)
     *
     * @param _from Address which sent the tokens
     * @param _value Amount of tokens sent
     * @param _data Byte array with information of which function to call and the parameters used for the invocation
    **/
    function tokenFallback(address _from, uint256 _value, bytes _data) public returns (bool) {
        if (_data.length < 4) return true;

        require(msg.sender == address(tokenContract));

        bytes4 signature = bytes4(uint32(_data[3]) + (uint32(_data[2]) << 8) + (uint32(_data[1]) << 16) + (uint32(_data[0]) << 24));

        if (signature == SIGN_NEW_BID) {
            bytes32 sealedBid = bytesToBytes32(_data, 4);

            newBidWithToken(_from, _value, sealedBid);
        } else if (signature == SIGN_PAY_RENT) {
            bytes32 name = bytesToBytes32(_data, 4);

            payRentWithToken(_from, _value, name);
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
