// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2;

/** @title Initializable */
/** @author Zergity */

interface Upgradable {
    function funcSelectors() external view returns (bytes4[] memory);
}
