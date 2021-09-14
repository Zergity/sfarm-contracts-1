pragma solidity ^0.6.2;

interface ICitizen {
    function setLzPool(address caller) external;
    function removeLzPool(address caller) external;
    function setReferrer(address newuser, address referrer) external;
    function getReferrer(address user) external returns (address);
}
