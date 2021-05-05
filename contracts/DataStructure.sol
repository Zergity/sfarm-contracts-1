// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2;

/** @title DataStructure */
/** @author Zergity */

import "./lib/StakeLib.sol";

// solium-disable security/no-block-members

/**
 * Data Structure and common logic
 */
contract DataStructure {
    // Upgradable Contract Proxy //
    mapping(bytes4 => address) impls;   // function signature => implementation contract address

    address baseToken;  // any authorized token deposit in here is denominated to this token
    address earnToken;  // reward token (ZD)

    mapping(address => bool)    authorizedTokens;
    mapping(address => bool)    authorizedPools;
    mapping(address => bool)    authorizedFarmers;

    mapping(address => Stake)   stakes; // stake denominated in baseToken and t
    Stake total;
    using StakeLib for Stake;

    event Farmer(address indexed farmer, bool enable);
    event Token(address indexed token, bool enable);
    event Router(address indexed router, bool enable);

    event Deposit(address indexed sender, address indexed token, uint value);
    event Withdraw(address indexed sender, address indexed token, uint value);
    event Harvest(address indexed sender, uint value);

    /**
     * we don't do that here
     */
    receive() external payable {
        revert("No thanks!");
    }
}
