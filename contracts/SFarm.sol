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

    function farmExec(address pool, bytes calldata input) external payable {
        require(pools[pool], "unauthorized pool");
        return _exec(pool, input);
    }

    function deposit(address token, uint amount) external {
        require(tokens[token], "unauthorized token");
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        total = total.deposit(amount);
        stakes[msg.sender] = stakes[msg.sender].deposit(amount);
        emit Deposit(msg.sender, token, amount);
    }

    struct ParamWithdraw {
        address token;
        uint    amount;
        address pool;
        bytes   input;
    }

    function withdraw(
        address token,
        uint    amount,
        ParamWithdraw[] calldata path
    ) external {
        for (uint i = 0; i < path.length; ++i) {
            address pool = path[i].pool;
            require(pools[pool], "unauthorized pool");

            (address pathToken, uint pathAmount) = (path[i].token, path[i].amount);
            require(IERC20(pathToken).balanceOf(address(this)) < pathAmount, "balance already sufficient");

            // TODO: check pool.funcSign authorization
            _exec(pool, path[i].input);
            require(IERC20(pathToken).balanceOf(address(this)) >= pathAmount, "balance insufficient");

            // accept 1% over removeLiquidity
            if (i > 0) {
                require(IERC20(path[i-1].token).balanceOf(address(this)) < path[i-1].amount / 100, "over liquidity withdraw");
            }
        }
        require(tokens[token], "unauthorized token");

        stakes[msg.sender] = stakes[msg.sender].withdraw(amount);
        total = total.withdraw(amount);

        IERC20(token).transfer(msg.sender, amount);

        // accept 1% over removeLiquidity
        if (path.length > 0) {
            require(IERC20(token).balanceOf(address(this)) < amount / 100, "over liquidity withdraw");
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

    function approve(address[] calldata tokens, address[] calldata _pools, uint amount) external {
        for (uint j = 0; j < _pools.length; ++j) {
            require(pools[_pools[j]], "unauthorized pool");
            for (uint i = 0; i < tokens.length; ++i) {
                IERC20(tokens[i]).approve(_pools[j], amount);
            }
        }
    }

    function setFarmers(address[] calldata add, address[] calldata remove) external {
        // @admin
        for (uint i; i < add.length; ++i) {
            address farmer = add[i];
            farmers[farmer] = true;
            emit Farmer(farmer, true);
        }
        for (uint i; i < remove.length; ++i) {
            address farmer = add[i];
            delete farmers[farmer];
            emit Farmer(farmer, false);
        }
    }

    function setPools(address[] calldata add, address[] calldata remove) external {
        // @admin
        for (uint i; i < add.length; ++i) {
            address router = add[i];
            pools[router] = true;
            emit Router(router, true);
        }
        for (uint i; i < remove.length; ++i) {
            address router = add[i];
            delete pools[router];
            emit Router(router, false);
        }
    }

    function setTokens(address[] calldata add, address[] calldata remove) external {
        // @admin
        for (uint i; i < add.length; ++i) {
            address token = add[i];
            tokens[token] = true;
            emit Token(token, true);
        }
        for (uint i; i < remove.length; ++i) {
            address token = add[i];
            delete tokens[token];
            emit Token(token, false);
        }
    }

    function _exec(address pool, bytes memory input) internal {
        (bool result,) = pool.call(input);

        // forward the call result to farmExec result, including revert reason
        assembly {
            let size := returndatasize()
            // Copy the returned data.
            returndatacopy(0, 0, size)

            switch result
            // delegatecall returns 0 on error.
            case 0 { revert(0, size) }
            default { return(0, size) }
        }
    }
}
