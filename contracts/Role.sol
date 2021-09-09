// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2;

/** @title SFarm */
/** @author Zergity */

// solium-disable security/no-inline-assembly

import "./DataStructure.sol";
import './interfaces/IERC20.sol';
import './interfaces/Upgradable.sol';

contract Role is Upgradable, DataStructure {
    modifier timelocked {
        if (msg.sender != address(this)) {
            require(total.stake() <= LOCK_FREE_STAKE, "!timelock");
            require(authorizedAdmins[msg.sender], "!admin");
        }
        _;
    }

    function setSubsidy(address recipient, uint rate) public timelocked {
        require(rate < SUBSIDY_UNIT, "subsidyRate overflow");
        subsidyRate = uint64(rate);
        if (recipient != address(0x0)) {
            subsidyRecipient = recipient;
        }
        emit NewSubsidy(subsidyRecipient, subsidyRate);
    }

    function ignoreAddress(address[] calldata accounts, bool ignore) external timelocked {
        for (uint i = 0; i < accounts.length; ++i) {
            address account = accounts[i];
            require(ignoredAddresses[account] != ignore, "ignore flag unchanged");
            ignoredAddresses[account] = ignore;
            if (ignore) {
                ignoredSupply += _balanceOf(account);
            } else {
                ignoredSupply -= _balanceOf(account);
            }
            emit AddressIngored(account, ignore);
        }
    }

    function allow(address[] calldata tokens, address[] calldata routers, uint amount) external timelocked {
        for (uint j = 0; j < routers.length; ++j) {
            address router = routers[j];
            require(authorizedRouters[router] > 0, "unauthorized router");
            for (uint i = 0; i < tokens.length; ++i) {
                IERC20(tokens[i]).approve(router, amount);
            }
        }
    }

    function authorizeAdmins(bytes32[] calldata changes) external timelocked {
        for (uint i; i < changes.length; ++i) {
            address admin = address(bytes20(changes[i]));
            require(admin != msg.sender, "no self remove");
            bool  enable = uint96(uint(changes[i])) > 0;
            require(authorizedAdmins[admin] != enable, "authorization unchanged");
            authorizedAdmins[admin] = enable;
            emit AuthorizeAdmin(admin, enable);
        }
    }

    function authorizeFarmers(bytes32[] calldata changes) external timelocked {
        for (uint i; i < changes.length; ++i) {
            address farmer = address(bytes20(changes[i]));
            bool  enable = uint96(uint(changes[i])) > 0;
            require(authorizedFarmers[farmer] != enable, "authorization unchanged");
            authorizedFarmers[farmer] = enable;
            emit AuthorizeFarmer(farmer, enable);
        }
    }

    function authorizeRouters(bytes32[] calldata changes) external timelocked {
        uint ROUTER_MASK = ROUTER_EARN_TOKEN + ROUTER_FARM_TOKEN + ROUTER_OWNERSHIP_PRESERVED;
        for (uint i; i < changes.length; ++i) {
            address router = address(bytes20(changes[i]));
            require(router != address(this), "nice try");
            uint mask = uint(changes[i]) & ROUTER_MASK;
            require(authorizedRouters[router] != mask, "authorization mask unchanged");
            authorizedRouters[router] = mask;
            emit AuthorizeRouter(router, mask);
        }
    }

    function authorizeTokens(bytes32[] calldata changes) external timelocked {
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
    function authorizeWithdrawalFuncs(bytes32[] calldata changes) external timelocked {
        uint ROUTER_MASK = ROUTER_FARM_TOKEN + ROUTER_OWNERSHIP_PRESERVED;
        for (uint i; i < changes.length; ++i) {
            address router = address(bytes20(changes[i]));
            require(router != address(this), "nice try");
            bytes4 func = bytes4(bytes12(uint96(uint(changes[i]))));
            uint mask = uint(changes[i]) & ROUTER_MASK;
            require(authorizedWithdrawalFunc[router][func] != mask, "authorization mask unchanged");
            authorizedWithdrawalFunc[router][func] = mask;
            emit AuthorizeWithdrawalFunc(router, func, mask);
        }
    }

    function pause(bool enable) public onlyAdmin {
        require(_paused != enable, "Pausable: unchanged");
        _paused = enable;
        emit Paused(enable, msg.sender);
    }

    function setReferralContract(address adr) public onlyAdmin {
        require(refContract != adr, "ReferralContract: unchanged");
        refContract = adr;
    }

    function setReferralRates(uint32[2] calldata rates) external timelocked {
        refRates = rates;
    }

    // DO NOT EDIT: auto-generated function
    function funcSelectors() external view override returns (bytes4[] memory signs) {
        signs = new bytes4[](11);
        signs[0] = 0x9999d616;		// setSubsidy(address,uint256)
        signs[1] = 0x84fee3e2;		// ignoreAddress(address[],bool)
        signs[2] = 0x95d739cd;		// allow(address[],address[],uint256)
        signs[3] = 0x596412b3;		// authorizeAdmins(bytes32[])
        signs[4] = 0x23ebd04f;		// authorizeFarmers(bytes32[])
        signs[5] = 0x222da3cf;		// authorizeRouters(bytes32[])
        signs[6] = 0xd3af0792;		// authorizeTokens(bytes32[])
        signs[7] = 0x76f95301;		// authorizeWithdrawalFuncs(bytes32[])
        signs[8] = 0x02329a29;		// pause(bool)
        signs[9] = 0x06ad5a47;		// setReferralContract(address)
        signs[10] = 0x76fd2bac;		// setReferralRates(uint32[2])
    }
}
