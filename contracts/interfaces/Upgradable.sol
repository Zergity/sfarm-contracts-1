// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2;

/** @title Initializable */
/** @author Zergity */

abstract contract Upgradable {
    /// func signature: 8129fc1c
    /// only to be delegatedCall by deployer contract
    // function initialize() external;

    modifier onlyCreator {
        bytes32 position = creatorPosition;
        address payable creator;
        assembly {
            creator := sload(position)
        }
        require(msg.sender == creator, "!creator");
        _;
    }

    bytes32 private constant creatorPosition = keccak256("contract.proxy.address"); 

    constructor() public {
        bytes32 position = creatorPosition;
        address creator = msg.sender;
        assembly {
            sstore(position, creator)
        }
    }

    // only to be called by its deployer contract (msg.sender in constructor)
    function destruct() external onlyCreator {
        selfdestruct(msg.sender);
    }

    function funcSelectors() external virtual view returns (bytes4[] memory);
}
