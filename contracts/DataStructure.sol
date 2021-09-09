// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2;

/** @title DataStructure */
/** @author Zergity */

import "./lib/StakeLib.sol";

// solium-disable security/no-block-members

/**
 * Data Structure and common logic
 */
contract DataStructure {
    // Upgradable Contract Proxy //
    mapping(bytes4 => address) impls;   // function signature => implementation contract address

    // TimeLock
    uint public delay;
    mapping (bytes32 => bool) public queuedTransactions;

    // admin operations require no locktime when the total stake in the farm not more than this value
    uint constant LOCK_FREE_STAKE = 10000 * 10**18;

    event NewDelay(uint indexed newDelay);
    event CancelTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature,  bytes data, uint eta);
    event ExecuteTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature,  bytes data, uint eta);
    event QueueTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature, bytes data, uint eta);

    // Token
    mapping (address => mapping (address => uint256)) _allowances;

    event Approval(address indexed owner, address indexed spender, uint value);
    event Transfer(address indexed from, address indexed to, uint value);

    // SFarm
    address earnToken;  // reward token (ZD)

    // Subsidty
    uint64  subsidyRate;        // [0,1) with 18 decimals
    address subsidyRecipient;

    uint constant SUBSIDY_UNIT = 10**18;
    event NewSubsidy(address recipient, uint rate);

    // Roles and Configs
    uint stakeTokensCount;  // number of authorizedTokens with TOKEN_LEVEL_STAKE

    mapping(address => bool)                    authorizedAdmins;
    mapping(address => bool)                    authorizedFarmers;

    mapping(address => uint)                    authorizedTokens;   // 1: receiving token, 2: staked token
    mapping(address => uint)                    authorizedRouters;  // 1: earn token, 2: staked token
    mapping(address => mapping(bytes4 => uint)) authorizedWithdrawalFunc;

    uint constant TOKEN_LEVEL_RECEIVABLE    = 1;
    uint constant TOKEN_LEVEL_STAKE         = 2;

    uint constant ROUTER_EARN_TOKEN             = 1 << 0;   // for earn token only
    uint constant ROUTER_FARM_TOKEN             = 1 << 1;   // for stake and intermediate tokens (LP, etc.)
    uint constant ROUTER_OWNERSHIP_PRESERVED    = 1 << 2;   // router that always use msg.sender as recipient

    event AuthorizeAdmin(address indexed admin, bool enable);
    event AuthorizeFarmer(address indexed farmer, bool enable);
    event AuthorizeToken(address indexed token, uint level);
    event AuthorizeRouter(address indexed router, uint mask);
    event AuthorizeWithdrawalFunc(address indexed router, bytes4 indexed func, uint mask);

    event FarmerExec(address indexed receivingToken, address indexed router, bytes4 indexed func);
    event ProcessOutstandingToken(address indexed router, bytes4 indexed func);

    // Stake and Contribution
    mapping(address => Stake)   stakes;
    Stake total;
    using StakeLib for Stake;

    event Deposit(address indexed sender, address indexed token, uint value);
    event Withdraw(address indexed sender, address indexed token, uint value);
    event Harvest(address indexed sender, uint value, uint subsidy);

    // Supply
    uint                        ignoredSupply;
    mapping (address => bool)   ignoredAddresses;   // set of addresses to be ignored from total supply
    event AddressIngored(address account, bool ignored);

    // Pausable
    bool _paused;
    event Paused(bool indexed enable, address account);

    // Referral
    address     refContract;
    uint32[2]   refRates;  // [0,1) with 9 decimals
    uint        constant REF_RATE_UNIT = 10**9;

    /**
     * @dev Modifier to make a function callable only when the contract is not paused.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    modifier whenNotPaused() {
        require(!_paused, "Pausable: paused");
        _;
    }

    modifier onlyAdmin {
        require(authorizedAdmins[msg.sender], "!admin");
        _;
    }

    function _mint(address account, uint amount, bool lock) internal {
        stakes[account] = stakes[account].deposit(amount, lock);
        total = total.deposit(amount, lock);
        if (ignoredAddresses[account]) {
            ignoredSupply += amount;
        }
    }

    function _burn(address account, uint amount) internal {
        stakes[account] = stakes[account].withdraw(amount);
        total = total.withdraw(amount);
        if (ignoredAddresses[account]) {
            ignoredSupply -= amount;
        }
    }

    function _balanceOf(address account) internal view returns (uint) {
        return stakes[account].stake();
    }

    function _totalSupply() internal view returns (uint) {
        return total.stake() - ignoredSupply;
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
