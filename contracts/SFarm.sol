// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2;
pragma experimental ABIEncoderV2;

/** @title SFarm */
/** @author Zergity */

// solium-disable security/no-inline-assembly

import "./DataStructure.sol";
import './interfaces/IUniswapV2Router01.sol';
import './interfaces/IERC20.sol';

contract SFarm is DataStructure {
    using SafeMath for uint;
    using SafeMath for uint192;
    using SafeMath for uint64;

    // accept 1/LEFT_OVER_RATE token left over
    uint constant LEFT_OVER_RATE = 100;

    constructor(address _baseToken, address _earnToken) public {
        _initialize(_baseToken, _earnToken);
    }

    /// reserved for proxy contract
    function initialize(address _baseToken, address _earnToken) public {
        require(msg.sender == address(this), "!internal");
        _initialize(_baseToken, _earnToken);
    }

    function _initialize(address _baseToken, address _earnToken) internal {
        baseToken = _baseToken;
        earnToken = _earnToken;
    }

    function funcSign(bytes memory input) internal pure returns (bytes4 output) {
        assembly {
            output := mload(add(input, 32))
        }
    }

    function farmExec(address receivingToken, address pool, bytes calldata input) external {
        // TODO: require authorizedFarmers[msg.sender]
        require(authorizedPools[pool], "unauthorized pool");
        require(authorizedTokens[receivingToken] >= TOKEN_LEVEL_RECEIVABLE, "unauthorized receiving token");

        uint balanceBefore = IERC20(receivingToken).balanceOf(address(this));

        (bool success,) = pool.call(input);
        if (!success) {
            return _forwardCallResult(success);
        }

        require(IERC20(receivingToken).balanceOf(address(this)) > balanceBefore, "token balance unchanged");
    }

    function deposit(address token, uint amount) external {
        require(authorizedTokens[token] == TOKEN_LEVEL_STAKE, "unauthorized token");
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
        address pool;
        bytes   input;
    }

    function withdraw(
        address     token,
        uint        amount,
        paramRL[]   calldata rls
    ) external {
        require(authorizedTokens[token] == TOKEN_LEVEL_STAKE, "unauthorized token");
        stakes[msg.sender] = stakes[msg.sender].withdraw(amount);
        total = total.withdraw(amount);
        
        uint[] memory lastBalance = new uint[](rls.length);

        for (uint i = 0; i < rls.length; ++i) {
            address receivingToken = rls[i].receivingToken;
            require(authorizedTokens[receivingToken] >= TOKEN_LEVEL_RECEIVABLE, "unauthorized receiving token");

            uint firstBalance = IERC20(receivingToken).balanceOf(address(this));
            lastBalance[i] = firstBalance;
            for (uint j = 0; j < rls[i].execs.length; ++j) {
                address pool = rls[i].execs[i].pool;
                require(authorizedWithdrawalFunc[pool][funcSign(rls[i].execs[j].input)], "unauthorized withdrawal");

                (bool success,) = pool.call(rls[i].execs[j].input);
                if (!success) {
                    return _forwardCallResult(success);
                }

                uint newBalance = IERC20(receivingToken).balanceOf(address(this));
                require(newBalance > lastBalance[i], "token balance unchanged");
                lastBalance[i] = newBalance;
            }
        }

        IERC20(token).transfer(msg.sender, amount);

        // accept 1% token left over
        for (uint i = 0; i < rls.length; ++i) {
            require(IERC20(rls[i].receivingToken).balanceOf(address(this)) <= lastBalance[i] / LEFT_OVER_RATE, "too many token leftover");
        }

        emit Withdraw(msg.sender, token, amount);
    }

    // this function allow farmer to convert token fee earn from LP in the authorizedTokens
    function processOutstandingToken(
        address             pool,           // LP pool to swap token to earnToken
        bytes     calldata  input,
        address[] calldata  tokens
    ) external {
        require(tokens.length == stakeTokensCount, "incorrect tokens count");
        require(authorizedEarnTokenPools[pool], "unauthorized earn token pool");

        uint lastBalance = IERC20(earnToken).balanceOf(address(this));

        (bool success,) = pool.call(input);
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
        earn = totalEarn > value ? value.mul(totalEarn/scale) : totalEarn.mul(value/scale);
        earn = (earn/totalValue).mul(scale);

        IERC20(earnToken).transfer(msg.sender, earn);
        emit Harvest(msg.sender, earn);
    }

    function approve(address[] calldata tokens, address[] calldata pools, uint amount) external {
        for (uint j = 0; j < pools.length; ++j) {
            address pool = pools[j];
            // TODO: merge 2 pools into 1
            require(authorizedPools[pool] || authorizedEarnTokenPools[pool], "unauthorized pool");
            for (uint i = 0; i < tokens.length; ++i) {
                IERC20(tokens[i]).approve(pool, amount);
            }
        }
    }

    function authorizeFarmers(address[] calldata add, address[] calldata remove) external {
        // @admin
        for (uint i; i < add.length; ++i) {
            address farmer = add[i];
            authorizedFarmers[farmer] = true;
            emit AuthorizeFarmer(farmer, true);
        }
        for (uint i; i < remove.length; ++i) {
            address farmer = add[i];
            delete authorizedFarmers[farmer];
            emit AuthorizeFarmer(farmer, false);
        }
    }

    function authorizePools(address[] calldata add, address[] calldata remove) external {
        // @admin
        for (uint i; i < add.length; ++i) {
            address router = add[i];
            authorizedPools[router] = true;
            emit AuthorizePool(router, true);
        }
        for (uint i; i < remove.length; ++i) {
            address router = add[i];
            delete authorizedPools[router];
            emit AuthorizePool(router, false);
        }
    }

    function authorizeTokens(bytes32[] calldata changes) external {
        // @admin
        for (uint i; i < changes.length; ++i) {
            address token = address(bytes20(changes[i]));
            uint96  level = uint96(uint(changes[i]));
            uint oldLevel = authorizedTokens[token];
            require(oldLevel != level, "token authorization level unchanged");
            if (level == TOKEN_LEVEL_STAKE) {
                stakeTokensCount++;
            } else if (oldLevel == TOKEN_LEVEL_STAKE) {
                stakeTokensCount--;
        }
            authorizedTokens[token] = level;
            emit AuthorizeToken(token, level);
        }
    }

    function authorizeEarnTokenPools(bytes32[] calldata changes) external {
        // @admin
        for (uint i; i < changes.length; ++i) {
            address pool = address(bytes20(changes[i]));
            bool  enable = uint96(uint(changes[i])) > 0;
            require(authorizedEarnTokenPools[pool] != enable, "pool authorization unchanged");
            authorizedEarnTokenPools[pool] = enable;
            emit AuthorizedEarnTokenPool(pool, enable);
        }
    }

    struct paramFunc {
        address pool;
        bytes4  func;
    }

    function authorizeWithdrawalFuncs(paramFunc[] calldata add, paramFunc[] calldata remove) external {
        // @admin
        for (uint i; i < add.length; ++i) {
            address pool = add[i].pool;
            bytes4  func = add[i].func;
            authorizedWithdrawalFunc[pool][func] = true;
            emit AuthorizeWithdrawalFunc(pool, func, true);
        }
        for (uint i; i < remove.length; ++i) {
            address pool = remove[i].pool;
            bytes4  func = remove[i].func;
            delete authorizedWithdrawalFunc[pool][func];
            emit AuthorizeWithdrawalFunc(pool, func, false);
        }
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
