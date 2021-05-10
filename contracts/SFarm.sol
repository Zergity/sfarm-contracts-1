// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2;
pragma experimental ABIEncoderV2;

/** @title SFarm */
/** @author Zergity */

// solium-disable security/no-inline-assembly

import "./Timelock.sol";
import './interfaces/IUniswapV2Router01.sol';
import './interfaces/IERC20.sol';

contract SFarm is Timelock {
    using SafeMath for uint;
    using SafeMath for uint192;
    using SafeMath for uint64;

    // accept 1/LEFT_OVER_RATE token left over
    uint constant LEFT_OVER_RATE = 100;

    constructor(
        address _baseToken,
        address _earnToken,
        address _admin,
        uint _subsidyRate,
        uint _delay
    ) Timelock(_delay) public {
        require(_subsidyRate < SUBSIDY_UNIT, "subsidyRate overflow");
        subsidyRate = uint64(_subsidyRate);
        if (_admin == address(0x0)) {
            _admin = msg.sender;
        }
        subsidyRecipient = _admin;
        authorizedAdmins[_admin] = true;
        baseToken = _baseToken;
        earnToken = _earnToken;
    }

    function deposit(address token, uint amount) external {
        require(_isTokenStakable(token), "unauthorized token");
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        total = total.deposit(amount);
        stakes[msg.sender] = stakes[msg.sender].deposit(amount);
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
    ) external {
        require(_isTokenStakable(token), "unauthorized token");
        stakes[msg.sender] = stakes[msg.sender].withdraw(amount);
        total = total.withdraw(amount);

        uint[] memory lastBalance = new uint[](rls.length);

        for (uint i = 0; i < rls.length; ++i) {
            address receivingToken = rls[i].receivingToken;

            if (receivingToken != address(0x0)) {
                require(_isTokenReceivable(receivingToken), "unauthorized receiving token");
                lastBalance[i] = IERC20(receivingToken).balanceOf(address(this));
            }

            for (uint j = 0; j < rls[i].execs.length; ++j) {
                address router = rls[i].execs[i].router;

                uint mask = authorizedWithdrawalFunc[router][_funcSign(rls[i].execs[j].input)];
                require(_isRouterForStakeToken(mask), "unauthorized router.function");
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

    function farmerExec(address receivingToken, address router, bytes calldata input) external {
        require(authorizedFarmers[msg.sender], "unauthorized farmer");
        uint mask = authorizedRouters[router];
        require(_isRouterForStakeToken(mask), "unauthorized router");

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
    ) external {
        require(authorizedFarmers[msg.sender], "unauthorized farmer");

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

    function setSubsidy(address recipient, uint rate) external {
        require(authorizedAdmins[msg.sender], "!admin");
        require(rate < SUBSIDY_UNIT, "subsidyRate overflow");
        subsidyRate = uint64(rate);
        if (recipient != address(0x0)) {
            subsidyRecipient = recipient;
        }
    }

    function approve(address[] calldata tokens, address[] calldata routers, uint amount) external {
        require(authorizedAdmins[msg.sender], "!admin");
        for (uint j = 0; j < routers.length; ++j) {
            address router = routers[j];
            require(authorizedRouters[router] > 0, "unauthorized router");
            for (uint i = 0; i < tokens.length; ++i) {
                IERC20(tokens[i]).approve(router, amount);
            }
        }
    }

    function authorizeAdmins(bytes32[] calldata changes) external {
        require(authorizedAdmins[msg.sender], "!admin");
        for (uint i; i < changes.length; ++i) {
            address admin = address(bytes20(changes[i]));
            require(admin != msg.sender, "no self remove");
            bool  enable = uint96(uint(changes[i])) > 0;
            require(authorizedAdmins[admin] != enable, "authorization unchanged");
            authorizedAdmins[admin] = enable;
            emit AuthorizeAdmin(admin, enable);
        }
    }

    function authorizeFarmers(bytes32[] calldata changes) external {
        require(authorizedAdmins[msg.sender], "!admin");
        for (uint i; i < changes.length; ++i) {
            address farmer = address(bytes20(changes[i]));
            bool  enable = uint96(uint(changes[i])) > 0;
            require(authorizedFarmers[farmer] != enable, "authorization unchanged");
            authorizedFarmers[farmer] = enable;
            emit AuthorizeFarmer(farmer, enable);
        }
    }

    function authorizeRouters(bytes32[] calldata changes) external {
        require(authorizedAdmins[msg.sender], "!admin");
        uint ROUTER_MASK = ROUTER_EARN_TOKEN + ROUTER_STAKE_TOKEN + ROUTER_OWNERSHIP_PRESERVED;
        for (uint i; i < changes.length; ++i) {
            address router = address(bytes20(changes[i]));
            uint mask = uint(changes[i]) & ROUTER_MASK;
            require(authorizedRouters[router] != mask, "authorization mask unchanged");
            authorizedRouters[router] = mask;
            emit AuthorizeRouter(router, mask);
        }
    }

    function authorizeTokens(bytes32[] calldata changes) external {
        require(authorizedAdmins[msg.sender], "!admin");
        for (uint i; i < changes.length; ++i) {
            address token = address(bytes20(changes[i]));
            uint96  level = uint96(uint(changes[i]));
            uint oldLevel = authorizedTokens[token];
            require(oldLevel != level, "authorization level unchanged");
            if (level == TOKEN_LEVEL_STAKE) {
                stakeTokensCount++;
            } else if (oldLevel == TOKEN_LEVEL_STAKE) {
                stakeTokensCount--;
            }
            authorizedTokens[token] = level;
            emit AuthorizeToken(token, level);
        }
    }

    // 20 bytes router address + 4 bytes func signature + 8 bytes bool
    function authorizeWithdrawalFuncs(bytes32[] calldata changes) external {
        require(authorizedAdmins[msg.sender], "!admin");
        uint ROUTER_MASK = ROUTER_STAKE_TOKEN + ROUTER_OWNERSHIP_PRESERVED;
        for (uint i; i < changes.length; ++i) {
            address router = address(bytes20(changes[i]));
            bytes4 func = bytes4(bytes12(uint96(uint(changes[i]))));
            uint mask = uint(changes[i]) & ROUTER_MASK;
            require(authorizedWithdrawalFunc[router][func] != mask, "authorization mask unchanged");
            authorizedWithdrawalFunc[router][func] = mask;
            emit AuthorizeWithdrawalFunc(router, func, mask);
        }
    }

    function _funcSign(bytes memory input) internal pure returns (bytes4 output) {
        assembly {
            output := mload(add(input, 32))
        }
    }

    function _isRouterForEarnToken(uint mask) internal pure returns (bool) {
        return mask & ROUTER_EARN_TOKEN != 0;
    }

    function _isRouterForStakeToken(uint mask) internal pure returns (bool) {
        return mask & ROUTER_STAKE_TOKEN != 0;
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

    // forward the last call result to the caller, including revert reason
    function _forwardCallResult(bool success) internal pure {
        assembly {
            let size := returndatasize()
            // Copy the returned data.
            returndatacopy(0, 0, size)

            switch success
            // delegatecall returns 0 on error.
            case 0 { revert(0, size) }
            default { return(0, size) }
        }
    }
}
