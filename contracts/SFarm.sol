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

    function farmExec(address token, address pool, bytes calldata input) external {
        // TODO: require authorizedFarmers[msg.sender]
        require(authorizedPools[pool], "unauthorized pool");
        uint balanceBefore = IERC20(token).balanceOf(address(this));

        (bool success,) = pool.call(input);

        if (success) {
            require(IERC20(token).balanceOf(address(this)) > balanceBefore, "token balance unchanged");
        }

        return _forwardCallResult(success);
    }

    function deposit(address token, uint amount) external {
        require(authorizedTokens[token], "unauthorized token");
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        total = total.deposit(amount);
        stakes[msg.sender] = stakes[msg.sender].deposit(amount);
        emit Deposit(msg.sender, token, amount);
    }

    struct paramRL {
        address token;
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
        require(authorizedTokens[token], "unauthorized token");
        stakes[msg.sender] = stakes[msg.sender].withdraw(amount);
        total = total.withdraw(amount);
        // if (rls.length == 0) revert("hello");
        
        uint[] memory lastBalance = new uint[](rls.length);

        for (uint i = 0; i < rls.length; ++i) {
            address lpToken = rls[i].token;
            uint firstBalance = IERC20(lpToken).balanceOf(address(this));
            lastBalance[i] = firstBalance;
            for (uint j = 0; j < rls[i].execs.length; ++j) {
                address pool = rls[i].execs[i].pool;
                require(authorizedPools[pool], "unauthorized pool");

                // TODO: check pool.funcSign authorization

                (bool success,) = pool.call(rls[i].execs[j].input);
                if (!success) {
                    return _forwardCallResult(success);
                }

                uint newBalance = IERC20(lpToken).balanceOf(address(this));
                require(newBalance > lastBalance[i], "token balance unchanged");
                lastBalance[i] = newBalance;
            }
        }

        IERC20(token).transfer(msg.sender, amount);

        // accept 1% token left over
        for (uint i = 0; i < rls.length; ++i) {
            address lpToken = rls[i].token;
            require(IERC20(lpToken).balanceOf(address(this)) <= lastBalance[i] / 100, "too many token leftover");
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
        earn = totalEarn > value ? value.mul(totalEarn/scale) : totalEarn.mul(value/scale);
        earn = (earn/totalValue).mul(scale);

        IERC20(earnToken).transfer(msg.sender, earn);
        emit Harvest(msg.sender, earn);
    }

    function approve(address[] calldata tokens, address[] calldata pools, uint amount) external {
        for (uint j = 0; j < pools.length; ++j) {
            require(authorizedPools[pools[j]], "unauthorized pool");
            for (uint i = 0; i < tokens.length; ++i) {
                IERC20(tokens[i]).approve(pools[j], amount);
            }
        }
    }

    function setFarmers(address[] calldata add, address[] calldata remove) external {
        // @admin
        for (uint i; i < add.length; ++i) {
            address farmer = add[i];
            authorizedFarmers[farmer] = true;
            emit Farmer(farmer, true);
        }
        for (uint i; i < remove.length; ++i) {
            address farmer = add[i];
            delete authorizedFarmers[farmer];
            emit Farmer(farmer, false);
        }
    }

    function setPools(address[] calldata add, address[] calldata remove) external {
        // @admin
        for (uint i; i < add.length; ++i) {
            address router = add[i];
            authorizedPools[router] = true;
            emit Router(router, true);
        }
        for (uint i; i < remove.length; ++i) {
            address router = add[i];
            delete authorizedPools[router];
            emit Router(router, false);
        }
    }

    function setTokens(address[] calldata add, address[] calldata remove) external {
        // @admin
        for (uint i; i < add.length; ++i) {
            address token = add[i];
            authorizedTokens[token] = true;
            emit Token(token, true);
        }
        for (uint i; i < remove.length; ++i) {
            address token = add[i];
            delete authorizedTokens[token];
            emit Token(token, false);
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
