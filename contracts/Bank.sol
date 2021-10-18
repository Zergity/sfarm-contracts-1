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

    // accept 1/LEFT_OVER_RATE token left over
    uint constant LEFT_OVER_RATE = 100;

    modifier onlyStakeToken(address token) {
        require(_isTokenStakable(token), "unauthorized token"); _;
    }

    modifier onlyFarmer {
        require(authorizedFarmers[msg.sender], "unauthorized farmer"); _;
    }

    function referAndDeposit(address referrer, address token, uint amount) public {
        ICitizen(refContract).setReferrer(msg.sender, referrer);
        if (amount > 0) {
            deposit(token, amount);
        }
    }

    function deposit(address token, uint amount) public onlyStakeToken(token) {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount, true);
        emit Transfer(address(0), msg.sender, amount);
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

        emit Transfer(msg.sender, address(0), amount);
        emit Withdraw(msg.sender, token, amount);
    }

    // harvest ZD
    function harvest(uint scale) public whenNotPaused returns (uint earn) {
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
        earn = bothEarn.sub(subsidyEarn);

        address citizen = msg.sender;
        for (uint i = 0; i < refRates.length; ++i) {
            uint refEarn = (totalEarn.mul(refRates[i])/REF_RATE_UNIT/totalValue).mul(scale);
            if (refEarn == 0) {
                continue;
            }
            earn = earn.sub(refEarn);

            citizen = ICitizen(refContract).getReferrer(citizen);
            if (citizen == address(0x0) || citizen == subsidyRecipient || stakes[citizen].stake() < refStakes[i]) {
                subsidyEarn = subsidyEarn.add(refEarn);
            } else {
                IERC20(earnToken).transfer(citizen, refEarn);
            }
        }

        if (subsidyEarn > 0 && subsidyRecipient != address(0x0)) {
            IERC20(earnToken).transfer(subsidyRecipient, subsidyEarn);
        }

        IERC20(earnToken).transfer(msg.sender, earn);

        emit Harvest(msg.sender, bothEarn-subsidyEarn, subsidyEarn);
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

        emit ProcessOutstandingToken(router, _funcSign(input));

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

    function query(address a) public view returns (
        uint stake,
        int contribution,
        uint totalStake,
        int totalContribution
    ) {
        return (
            stakes[a].stake(),
            stakes[a].rawValue(),
            total.stake(),
            total.rawValue()
        );
    }

    function queryConfig() public view returns (
        uint delay_,
        address earnToken_,
        uint subsidyRate_,
        address subsidyRecipient_,
        uint stakeTokensCount_,
        uint32[2] memory refRates_
    ) {
        return (
            delay,
            earnToken,
            uint(subsidyRate),
            subsidyRecipient,
            stakeTokensCount,
            refRates
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
        signs = new bytes4[](8);
        signs[0] = 0xc60b198f;		// referAndDeposit(address,address,uint256)
        signs[1] = 0x47e7ef24;		// deposit(address,uint256)
        signs[2] = 0xd2962152;		// withdraw(address,uint256,tuple[])
        signs[3] = 0xddc63262;		// harvest(uint256)
        signs[4] = 0x50658dad;		// farmerExec(address,address,bytes)
        signs[5] = 0xeb63a3d5;		// farmerProcessOutstandingToken(address,bytes,address[])
        signs[6] = 0xd4fc9fc6;		// query(address)
        signs[7] = 0xe68f909d;		// queryConfig()
    }
}
