// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2;
pragma experimental ABIEncoderV2;

/** @title SFarm */
/** @author Zergity */

// solium-disable security/no-inline-assembly

import "./DataStructure.sol";
import './interfaces/IUniswapV2Router01.sol';
import './interfaces/IERC20.sol';
import './interfaces/Upgradable.sol';

contract Bank is Upgradable, DataStructure {
    using SafeMath for uint;

    // accept 1/LEFT_OVER_RATE token left over
    uint constant LEFT_OVER_RATE = 100;

    modifier onlyStakeToken(address token) {
        require(_isTokenStakable(token), "unauthorized token"); _;
    }

    modifier onlyFarmer {
        require(authorizedFarmers[msg.sender], "unauthorized farmer"); _;
    }

    function deposit(address token, uint amount) external onlyStakeToken(token) {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount);
        emit Deposit(msg.sender, token, amount);
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
    ) external onlyStakeToken(token) {
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
                    require(_isRouterPreserveOwnership(mask), "router not authorized as ownership preserved");
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

        // accept 1% token left over
        for (uint i = 0; i < rls.length; ++i) {
            address receivingToken = rls[i].receivingToken;
            if (receivingToken != address(0x0)) {
                require(IERC20(receivingToken).balanceOf(address(this)) <= lastBalance[i] / LEFT_OVER_RATE, "too many token leftover");
            }
        }

        emit Withdraw(msg.sender, token, amount);
    }

    // harvest ZD
    function harvest(uint scale) external returns (uint earn) {
        Stake memory stake = stakes[msg.sender];
        uint value = stake.value();
        uint totalValue = total.value();

        // update the sender and total stake
        stakes[msg.sender] = stake.harvest(value);
        total = total.harvest(value);

        uint totalEarn = IERC20(earnToken).balanceOf(address(this));
        if (scale == 0) {
            scale = 1;
        }
        totalEarn = totalEarn > value ? value.mul(totalEarn/scale) : totalEarn.mul(value/scale);
        uint bothEarn = (totalEarn/totalValue).mul(scale);    // first, assign the total earned

        uint subsidyEarn = (totalEarn.mul(subsidyRate)/SUBSIDY_UNIT/totalValue).mul(scale);
        if (subsidyEarn > 0 && subsidyRecipient != address(0x0)) {
            IERC20(earnToken).transfer(subsidyRecipient, subsidyEarn);
        }

        earn = bothEarn.sub(subsidyEarn);
        IERC20(earnToken).transfer(msg.sender, earn);

        emit Harvest(msg.sender, earn, subsidyEarn);
    }

    function farmerExec(address receivingToken, address router, bytes calldata input) external onlyFarmer {
        uint mask = authorizedRouters[router];
        require(_isRouterForFarmToken(mask), "unauthorized router");

        emit FarmerExec(receivingToken, router, _funcSign(input));

        // skip the balance check for router that always use msg.sender instead of `recipient` field (unlike Uniswap)
        if (receivingToken == address(0x0)) {
            require(_isRouterPreserveOwnership(mask), "router not authorized as ownership preserved");
            (bool success,) = router.call(input);
            return _forwardCallResult(success);
        }

        require(_isTokenReceivable(receivingToken), "unauthorized receiving token");
        uint balanceBefore = IERC20(receivingToken).balanceOf(address(this));

        (bool success,) = router.call(input);
        if (!success) {
            return _forwardCallResult(success);
        }

        require(IERC20(receivingToken).balanceOf(address(this)) > balanceBefore, "token balance unchanged");
    }

    // this function allow farmer to convert token fee earn from LP in the authorizedTokens
    function farmerProcessOutstandingToken(
        address             router,           // LP router to swap token to earnToken
        bytes     calldata  input,
        address[] calldata  tokens
    ) external onlyFarmer {
        require(tokens.length == stakeTokensCount, "incorrect tokens count");
        require(_isRouterForEarnToken(authorizedRouters[router]), "unauthorized router");

        uint lastBalance = IERC20(earnToken).balanceOf(address(this));

        (bool success,) = router.call(input);
        if (!success) {
            return _forwardCallResult(success);
        }

        require(IERC20(earnToken).balanceOf(address(this)) > lastBalance, "earn token balance unchanged");

        // verify the remaining stake is sufficient
        uint totalBalance;
        for (uint i; i < tokens.length; ++i) {
            address token = tokens[i];
            for (uint j; j < i; ++j) {
                require(token != tokens[j], "duplicate tokens");
            }
            totalBalance = totalBalance.add(IERC20(token).balanceOf(address(this)));
        }
        require(total.stake() <= totalBalance, "over proccessed");
    }

    function query(address a) external view returns (
        uint stake,
        uint value,
        uint totalStake,
        uint totalValue
    ) {
        return (
            stakes[a].stake(),
            stakes[a].safeValue(),
            total.stake(),
            total.safeValue()
        );
    }

    function queryConfig() external view returns (
        uint delay_,
        address earnToken_,
        uint subsidyRate_,
        address subsidyRecipient_,
        uint stakeTokensCount_
    ) {
        return (
            delay,
            earnToken,
            uint(subsidyRate),
            subsidyRecipient,
            stakeTokensCount
        );
    }

    function _funcSign(bytes memory input) internal pure returns (bytes4 output) {
        assembly {
            output := mload(add(input, 32))
        }
    }

    function _isRouterForEarnToken(uint mask) internal pure returns (bool) {
        return mask & ROUTER_EARN_TOKEN != 0;
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
        signs = new bytes4[](7);
        signs[0] = 0x47e7ef24;		// deposit(address,uint256)
        signs[1] = 0xd2962152;		// withdraw(address,uint256,tuple[])
        signs[2] = 0xddc63262;		// harvest(uint256)
        signs[3] = 0x50658dad;		// farmerExec(address,address,bytes)
        signs[4] = 0xeb63a3d5;		// farmerProcessOutstandingToken(address,bytes,address[])
        signs[5] = 0xd4fc9fc6;		// query(address)
        signs[6] = 0xe68f909d;		// queryConfig()
    }
}
