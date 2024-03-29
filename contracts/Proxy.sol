// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2;

/** @title Proxy */
/** @author Zergity (https://endur.io) */

// solium-disable security/no-inline-assembly

import "./DataStructure.sol";
import "./interfaces/Upgradable.sol";

/**
 * Proxy is an ERC20 and an Upgradable Proxy
 *
 * @dev proxy class can't have any (structured) state variable, all state is located in DataStructure and Token
 */
contract Proxy is DataStructure {
    event Deployed(address indexed addr, bytes initCode, bytes4[] funcs);

    constructor(
        address _admin,
        address _earnToken
    ) public {
        if (_admin == address(0x0)) {
            _admin = msg.sender;
        }

        authorizedAdmins[_admin] = true;
        emit AuthorizeAdmin(_admin, true);

        earnToken = _earnToken;
    }

    function _mustDelegateCall(address impl, bytes memory data) internal {
        (bool ok,) = impl.delegatecall(data);
        if (!ok) {
            assembly {
                let size := returndatasize()
                returndatacopy(0, 0, size)
                revert(0, size)
            }
        }
    }

    function upgradeContract(address addr, bytes calldata initCode) external onlyAdmin {
        require(_isContract(addr), "!contract");

        // delegate call init for each implementations
        if (initCode.length > 0) {
            _mustDelegateCall(addr, initCode);
        }

        bytes4[] memory funcs = Upgradable(addr).funcSelectors();
        for (uint i = 0; i < funcs.length; ++i) {
            impls[funcs[i]] = addr;
        }
        emit Deployed(addr, initCode, funcs);
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

    function _isContract(address _addr) private view returns (bool isContract) {
        uint32 size;
        assembly {
            size := extcodesize(_addr)
        }
        return (size > 0);
    }

    // un-upgradable functions here

    /**
     * @dev Returns the name of the token.
     */
    function name() public pure returns (string memory) {
        return "LaunchZone USD";
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public pure returns (string memory) {
        return "USDZ";
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals `2`, a balance of `505` tokens should
     * be displayed to a user as `5,05` (`505 / 10 ** 2`).
     *
     * Tokens usually opt for a value of 18, imitating the relationship between
     * Ether and Wei. This is the value {ERC20} uses, unless {_setupDecimals} is
     * called.
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public pure returns (uint8) {
        return 18;
    }
}
