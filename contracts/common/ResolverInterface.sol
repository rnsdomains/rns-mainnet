pragma solidity ^0.4.24;

contract AbstractPublicResolver {
    function PublicResolver(address rnsAddr) public;
    function supportsInterface(bytes4 interfaceID) public pure returns (bool);
    function addr(bytes32 node) public view returns (address ret);
    function setAddr(bytes32 node, address addrValue) public;
    function content(bytes32 node) public view returns (bytes32 ret);
    function setContent(bytes32 node, bytes32 hashValue) public;
    function has(bytes32 node, bytes32 kind) public view returns (bool);
}
