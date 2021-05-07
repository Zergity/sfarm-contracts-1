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

    uint stakeTokensCount;  // number of authorizedTokens with TOKEN_LEVEL_STAKE

    mapping(address => uint)                    authorizedTokens;   // 1: receiving token, 2: staked token
    mapping(address => bool)                    authorizedPools;
    mapping(address => bool)                    authorizedFarmers;
    mapping(address => bool)                    authorizedEarnTokenPools;
    mapping(address => mapping(bytes4 => bool)) authorizedWithdrawalFunc;

    mapping(address => Stake)   stakes; // stake denominated in baseToken and t
    Stake total;
    using StakeLib for Stake;

    event AuthorizeFarmer(address indexed farmer, bool enable);
    event AuthorizeToken(address indexed token, uint level);
    event AuthorizePool(address indexed router, bool enable);
    event AuthorizedEarnTokenPool(address indexed pool, bool enable);
    event AuthorizeWithdrawalFunc(address indexed pool, bytes4 indexed func, bool enable);

    event Deposit(address indexed sender, address indexed token, uint value);
    event Withdraw(address indexed sender, address indexed token, uint value);
    event Harvest(address indexed sender, uint value);

    uint constant TOKEN_LEVEL_RECEIVABLE    = 1;
    uint constant TOKEN_LEVEL_STAKE         = 2;

    /**
     * we don't do that here
     */
    receive() external payable {
        revert("No thanks!");
    }
}
