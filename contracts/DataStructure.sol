// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2;

/** @title DataStructure */
/** @author Zergity */

// solium-disable security/no-block-members

import './interfaces/IUniswapV2Router01.sol';
import './interfaces/IERC20.sol';

/**
 * Data Structure and common logic
 */
contract DataStructure {
    // Upgradable Contract Proxy //
    mapping(bytes4 => address) impls;   // function signature => implementation contract address

    IERC20 baseToken;   // any authorized token deposit in here is denominated to this token

    mapping(address => bool)    routers;
    mapping(address => address) tokens; // token => LP(token/baseToken)
    mapping(address => bool)    farmers;

    /**
     * we don't do that here
     */
    receive() external payable {
        revert("No thanks!");
    }
}
