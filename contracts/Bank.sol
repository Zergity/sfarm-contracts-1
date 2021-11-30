// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2;
pragma experimental ABIEncoderV2;

/** @title SFarm */
/** @author Zergity */

// solium-disable security/no-inline-assembly

import "./DataStructure.sol";
import './interfaces/IERC20.sol';
import './interfaces/Upgradable.sol';
import './interfaces/ICitizen.sol';

contract Bank is Upgradable, DataStructure {
    using SafeMath for uint;

    modifier onlyStakeToken(address token) {
        require(_isTokenStakable(token), "unauthorized token"); _;
    }

    struct paramRL {
        address receivingToken;
        paramExec[] execs;
    }

    struct paramExec {
        address router;
        bytes   input;
    }

    function withdraw(
        address     token,
        uint        amount,
        paramRL[]   calldata rls
    ) external whenNotPaused onlyStakeToken(token) {
        _burn(msg.sender, amount);

        uint[] memory lastBalance = new uint[](rls.length);

        for (uint i = 0; i < rls.length; ++i) {
            address receivingToken = rls[i].receivingToken;

            if (receivingToken != address(0x0)) {
                require(_isTokenReceivable(receivingToken), "unauthorized receiving token");
                lastBalance[i] = IERC20(receivingToken).balanceOf(address(this));
            }

            for (uint j = 0; j < rls[i].execs.length; ++j) {
                address router = rls[i].execs[j].router;

                uint mask = authorizedWithdrawalFunc[router][_funcSign(rls[i].execs[j].input)];
                require(_isRouterForFarmToken(mask), "unauthorized router.function");
                if (receivingToken == address(0x0)) {
                    require(
                        _isRouterPreserveOwnership(mask),
                        "router not authorized as ownership preserved"
                    );
                }

                (bool success,) = router.call(rls[i].execs[j].input);
                if (!success) {
                    return _forwardCallResult(success);
                }

                if (receivingToken != address(0x0)) {
                    uint newBalance = IERC20(receivingToken).balanceOf(address(this));
                    require(newBalance > lastBalance[i], "token balance unchanged");
                    lastBalance[i] = newBalance;
                }
            }
        }

        IERC20(token).transfer(msg.sender, amount);

        emit Transfer(msg.sender, address(0), amount);
        emit Withdraw(msg.sender, token, amount);
    }

    function queryConfig() external view returns (
        uint delay_,
        address earnToken_,
        uint subsidyRate_,
        address subsidyRecipient_,
        uint stakeTokensCount_,
        bool paused_,
        uint32[REF_COUNT] memory refRates_,
        uint[REF_COUNT] memory refStakes_
    ) {
        return (
            delay,
            earnToken,
            uint(subsidyRate),
            subsidyRecipient,
            stakeTokensCount,
            _paused,
            refRates,
            refStakes
        );
    }

    function _funcSign(bytes memory input) internal pure returns (bytes4 output) {
        assembly {
            output := mload(add(input, 32))
        }
    }

    function _isRouterForFarmToken(uint mask) internal pure returns (bool) {
        return mask & ROUTER_FARM_TOKEN != 0;
    }

    function _isRouterPreserveOwnership(uint mask) internal pure returns (bool) {
        return mask & ROUTER_OWNERSHIP_PRESERVED != 0;
    }

    function _isTokenReceivable(address token) internal view returns (bool) {
        return authorizedTokens[token] >= TOKEN_LEVEL_RECEIVABLE;
    }

    function _isTokenStakable(address token) internal view returns (bool) {
        return authorizedTokens[token] >= TOKEN_LEVEL_STAKE;
    }

    // DO NOT EDIT: auto-generated function
    function funcSelectors() external view override returns (bytes4[] memory signs) {
        signs = new bytes4[](2);
        signs[0] = 0xd2962152;		// withdraw(address,uint256,tuple[])
        signs[1] = 0xe68f909d;		// queryConfig()
    }
}
