pragma solidity >=0.6.2;

import "./interfaces/Upgradable.sol";
import "./DataStructure.sol";
import "./lib/SafeMath.sol";

contract Timelock is Upgradable, DataStructure {
    using SafeMath for uint;

    uint public constant GRACE_PERIOD = 14 days;
    uint public constant MINIMUM_DELAY = 2 days;
    uint public constant MAXIMUM_DELAY = 30 days;

    function setDelay(uint delay_) public onlyAdmin {
        require(delay_ >= MINIMUM_DELAY, "Timelock::setDelay: Delay must exceed minimum delay.");
        require(delay_ <= MAXIMUM_DELAY, "Timelock::setDelay: Delay must not exceed maximum delay.");
        delay = delay_;

        emit NewDelay(delay);
    }

    function queueTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public onlyAdmin returns (bytes32) {
        require(eta >= getBlockTimestamp().add(delay), "Timelock::queueTransaction: Estimated execution block must satisfy delay.");

        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queuedTransactions[txHash] = true;

        emit QueueTransaction(txHash, target, value, signature, data, eta);
        return txHash;
    }

    function cancelTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public onlyAdmin {
        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        queuedTransactions[txHash] = false;

        emit CancelTransaction(txHash, target, value, signature, data, eta);
    }

    function executeTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) public payable  onlyAdmin {
        bytes32 txHash = keccak256(abi.encode(target, value, signature, data, eta));
        require(queuedTransactions[txHash], "Timelock::executeTransaction: Transaction hasn't been queued.");
        require(getBlockTimestamp() >= eta, "Timelock::executeTransaction: Transaction hasn't surpassed time lock.");
        require(getBlockTimestamp() <= eta.add(GRACE_PERIOD), "Timelock::executeTransaction: Transaction is stale.");

        queuedTransactions[txHash] = false;

        bytes memory callData;

        if (bytes(signature).length == 0) {
            callData = data;
        } else {
            callData = abi.encodePacked(bytes4(keccak256(bytes(signature))), data);
        }

        // solium-disable-next-line security/no-call-value
        (bool success,) = target.call.value(value)(callData);

        if (success) {
            emit ExecuteTransaction(txHash, target, value, signature, data, eta);
        }

        return _forwardCallResult(success);
    }

    function getBlockTimestamp() internal view returns (uint) {
        // solium-disable-next-line security/no-block-members
        return block.timestamp;
    }

    // DO NOT EDIT: auto-generated function
    function funcSelectors() external view override returns (bytes4[] memory signs) {
        signs = new bytes4[](7);
        signs[0] = 0xc1a287e2;		// GRACE_PERIOD()
        signs[1] = 0x7d645fab;		// MAXIMUM_DELAY()
        signs[2] = 0xb1b43ae5;		// MINIMUM_DELAY()
        signs[3] = 0xe177246e;		// setDelay(uint256)
        signs[4] = 0x3a66f901;		// queueTransaction(address,uint256,string,bytes,uint256)
        signs[5] = 0x591fcdfe;		// cancelTransaction(address,uint256,string,bytes,uint256)
        signs[6] = 0x0825f38f;		// executeTransaction(address,uint256,string,bytes,uint256)
    }
}