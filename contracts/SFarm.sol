// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2;

/** @title SFarm */
/** @author Zergity */

// solium-disable security/no-inline-assembly

import "./DataStructure.sol";
import "./lib/UniswapV2Library.sol";

contract SFarm is DataStructure {
    constructor(IERC20 _baseToken) public {
        initialize(_baseToken);
    }

    /// reserved for proxy contract
    function initialize(IERC20 _baseToken) public {
        require(msg.sender == address(this), "!internal");
        baseToken = _baseToken;
        tokens[address(_baseToken)] = address(0x1);
    }

    function setFarmer(address farmer, bool enable) external {
        // @admin
        farmers[farmer] = enable;
    }

    function setRouter(IUniswapV2Router01 router, bool enable) external {
        // @admin
        routers[address(router)] = enable;
    }

    function setToken(IERC20 token, address factory, bytes32 initCodeHash) external {
        // @admin
        if (factory == address(0x0)) {
            delete tokens[address(token)];
        } else {
            tokens[address(token)] = UniswapV2Library.pairFor(factory, initCodeHash, address(baseToken), address(token));
        }
    }
}
