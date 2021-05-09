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

    mapping(address => bool)                    authorizedFarmers;

    mapping(address => uint)                    authorizedTokens;   // 1: receiving token, 2: staked token
    mapping(address => uint)                    authorizedRouters;  // 1: earn token, 2: staked token
    mapping(address => mapping(bytes4 => uint)) authorizedWithdrawalFunc;

    mapping(address => Stake)   stakes; // stake denominated in baseToken and t
    Stake total;
    using StakeLib for Stake;

    event AuthorizeFarmer(address indexed farmer, bool enable);
    event AuthorizeToken(address indexed token, uint level);
    event AuthorizeRouter(address indexed router, uint mask);
    event AuthorizeWithdrawalFunc(address indexed router, bytes4 indexed func, uint mask);

    event Deposit(address indexed sender, address indexed token, uint value);
    event Withdraw(address indexed sender, address indexed token, uint value);
    event Harvest(address indexed sender, uint value);

    uint constant TOKEN_LEVEL_RECEIVABLE    = 1;
    uint constant TOKEN_LEVEL_STAKE         = 2;

    uint constant ROUTER_EARN_TOKEN             = 1 << 0;
    uint constant ROUTER_STAKE_TOKEN            = 1 << 1;
    uint constant ROUTER_OWNERSHIP_PRESERVED    = 1 << 2;     // router that always use msg.sender as recipient

    /**
     * we don't do that here
     */
    receive() external payable {
        revert("No thanks!");
    }
}
