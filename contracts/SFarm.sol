// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2;

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
        initialize(_baseToken, _earnToken);
    }

    /// reserved for proxy contract
    function initialize(address _baseToken, address _earnToken) public {
        require(msg.sender == address(this), "!internal");
        baseToken = _baseToken;
        earnToken = _earnToken;
    }

    function deposit(address token, uint amount) external {
        require(tokens[token], "token not support");
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        total = total.deposit(amount);
        stakes[msg.sender] = stakes[msg.sender].deposit(amount);
        emit Deposit(msg.sender, token, amount);
    }

    function withdraw(address token, uint amount) external {
        require(tokens[token], "token not support");
        stakes[msg.sender] = stakes[msg.sender].withdraw(amount);
        total = total.withdraw(amount);
        IERC20(token).transfer(msg.sender, amount);
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

    function setRouters(address[] calldata add, address[] calldata remove) external {
        // @admin
        for (uint i; i < add.length; ++i) {
            address router = add[i];
            routers[router] = true;
            emit Router(router, true);
        }
        for (uint i; i < remove.length; ++i) {
            address router = add[i];
            delete routers[router];
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
}
