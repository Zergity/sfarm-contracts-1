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

    function pause(bool enable) public onlyAdmin {
        require(_paused != enable, "Pausable: unchanged");
        _paused = enable;
        emit Paused(enable, msg.sender);
    }

    function setReferralContract(address adr) public onlyAdmin {
        require(refContract != adr, "ReferralContract: unchanged");
        refContract = adr;
    }

    function setReferralLevels(uint32[2] calldata rates, uint[2] calldata stakes) external timelocked {
        refRates = rates;
        refStakes = stakes;
    }

    // DO NOT EDIT: auto-generated function
    function funcSelectors() external view override returns (bytes4[] memory signs) {
        signs = new bytes4[](3);
        signs[0] = 0x02329a29;		// pause(bool)
        signs[1] = 0x06ad5a47;		// setReferralContract(address)
        signs[2] = 0x9953b158;		// setReferralLevels(uint32[2],uint256[2])
    }
}
