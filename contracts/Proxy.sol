// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2;

/** @title Proxy */
/** @author Zergity (https://endur.io) */

// solium-disable security/no-inline-assembly

import "./Token.sol";
import "./DataStructure.sol";

/**
 * Proxy is an ERC20 and an Upgradable Proxy with 3 implementation contracts: PoR, BrandMarket and RefNetwork
 *
 * @dev proxy class can't have any (structured) state variable, all state is located in DataStructure and Token
 */
contract Proxy is DataStructure, Token {
    /**
     * @dev Emitted when the implementation is changed.
     * @param signature 4-bytes function signature.
     * @param implementation Address of the new implementation.
     */
    event Implementation(bytes32 indexed signature, address indexed implementation);

    constructor(
        // address implERC20,
        address implBrandMarket,
        address implRefNetwork,
        address implPoR
    ) public {
        // delegate call initialize() for each implementations
        mustDelegateCall(implBrandMarket, hex"8129fc1c");

        // All ERC20 functions are not upgradable

        // generator script: change the contract name in export part
        // (export CONTRACT=PoR; cat ./build/contracts/$CONTRACT.json | sed -ne '/"legacyAST": {/,$p' | grep -A7 functionSelector | grep 'functionSelector\|"name": "' | sed 's/[",]//g' | sed 's/.*: //g' | sed 'N;s/\n/ /' | awk '{print "impls[0x"$0}' | sed "s/ /] = impl$CONTRACT;\t\/\/ /g")
        impls[0x0af77eb1] = implBrandMarket;    // activate
        impls[0x22eee84c] = implBrandMarket;    // deactivate
        impls[0x56cb121d] = implBrandMarket;    // queryCampaign
        impls[0xcfb083c0] = implPoR;    // claim
        impls[0xf4b0bafa] = implPoR;    // submit
        impls[0x7a0ca1e2] = implRefNetwork;     // attach
        impls[0xe5d9c0ad] = implRefNetwork;     // update
        impls[0xd4fc9fc6] = implRefNetwork;     // query
        impls[0xdffb35bb] = implRefNetwork;     // setCutbackRate
        impls[0x11d2eb02] = implRefNetwork;     // reward
    }

    function mustDelegateCall(address impl, bytes memory data) internal {
        (bool ok,) = impl.delegatecall(data);
        if (!ok) {
            assembly {
                let size := returndatasize()
                returndatacopy(0, 0, size)
                revert(0, size)
            }
        }
    }

    /**
     * Extra function to attach a message to a transfer
     *
     * Requirements:
     * - `recipient` cannot be the zero address.
     * - the caller must have a balance of at least `amount`.
     */
    function transfer(address recipient, uint256 amount, bytes calldata) external returns (bool) {
        _transfer(_msgSender(), recipient, amount);
        return true;
    }

    /**
     * set the implementation contract for a single function signature.
     */
    function setImplementation(bytes32 sign, address impl) external onlyAdmin {
        // TODO: verify impl is a contract
        _setImplementation(sign, impl);
    }

    /**
     * set implementation contract for multiple function signatures,
     * packed in the signs from the left.
     */
    function setImplementations(bytes32 signs, address impl) external onlyAdmin {
        // TODO: verify impl is a contract
        bytes32 ss = signs;
        for (uint i = 0; i < 8; ++i) {
            bytes4 sign = bytes4(ss);
            if (sign == 0) {
                return;
            }
            _setImplementation(sign, impl);
            ss <<= 32;
        }
    }

    function _setImplementation(bytes32 sign, address impl) internal {
        impls[bytes4(sign)] = impl;
        emit Implementation(sign, impl);
    }

    /**
     * prevent accidentally sending ether here
     */
    receive() external payable {
        revert("no thanks");
    }

    /**
     * @dev fallback implementation.
     * Extracted to enable manual triggering.
     */
    fallback() external payable {
        _delegate(_implementation());
    }

    /**
     * @dev Returns the current implementation.
     * @return Address of the current implementation
     */
    function _implementation() internal view returns (address) {
        address impl = impls[msg.sig];
        require(impl != address(0x0), "function not exist");
        return impl;
    }

    /**
     * @dev Delegates execution to an implementation contract.
     * This is a low level function that doesn't return to its internal call site.
     * It will return to the external caller whatever the implementation returns.
     * @param implementation Address to delegate.
     */
    function _delegate(address implementation) internal {
        assembly {
            // Copy msg.data. We take full control of memory in this inline assembly
            // block because it will not return to Solidity code. We overwrite the
            // Solidity scratch pad at memory position 0.
            calldatacopy(0, 0, calldatasize())

            // Call the implementation.
            // out and outsize are 0 because we don't know the size yet.
            let result := delegatecall(gas(), implementation, 0, calldatasize(), 0, 0)

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
