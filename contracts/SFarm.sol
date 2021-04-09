// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2;

/** @title SFarm */
/** @author Zergity */

// solium-disable security/no-inline-assembly

import "./DataStructure.sol";

contract SFarm is DataStructure {
    constructor(IERC20 _baseToken) public {
        initialize(_baseToken);
    }

    /// reserved for proxy contract
    function initialize(IERC20 _baseToken) public {
        require(msg.sender == address(this), "!internal");
        baseToken = _baseToken;
        tokens[address(_baseToken)] = true;
    }

    function setFarmer(address farmer, bool enable) external {
        // @admin
        farmers[farmer] = enable;
    }

    function setRouter(IUniswapV2Router01 router, bool enable) external {
        // @admin
        routers[address(router)] = enable;
    }

    function setToken(IERC20 token, bool enable) external {
        // @admin
        tokens[address(token)] = enable;
    }
}
