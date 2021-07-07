pragma solidity ^0.6.2;

/** @title StakeLib */
/** @author Zergity */

import "./SafeMath.sol";

struct Stake {
    uint192 s;
    uint64  t;
}

library StakeLib {
    using SafeMath for uint;
    using SafeMath for uint192;
    using SafeMath for uint64;

    uint constant STAKE_LOCK = 1 days;

    uint constant MAX_S = 2**192-1;
    uint constant MAX_T = 2**64-1;

    function safeValue(Stake memory a) internal view returns (uint) {
        if (a.t == MAX_T) {
            return a.s;
        }
        if (block.timestamp <= a.t) {
            return 0;
        }
        return block.timestamp.sub(a.t).mul(a.s);
    }

    function value(Stake memory a) internal view returns (uint) {
        return a.t == MAX_T ? a.s : block.timestamp.sub(a.t).mul(a.s);
    }

    function stake(Stake memory a) internal pure returns (uint) {
        return a.t == MAX_T ? 0 : a.s;
    }

    // add a stake lock duration prevent griefing attack
    function deposit(Stake memory a, uint amount) internal view returns (Stake memory) {
        uint s; uint t;
        if (a.t == MAX_T) {
            // av = a.s
            s = amount;
            t = block.timestamp.sub(a.s/amount).add(STAKE_LOCK);
        } else {
            s = a.s.add(amount);
            if (block.timestamp >= a.t) {
                uint av = block.timestamp.sub(a.t).mul(a.s);
                t = block.timestamp.sub(av/s);
            } else {
                uint av = a.t.sub(block.timestamp).mul(a.s);
                t = block.timestamp.add(av/s);
            }
            t = t.add(STAKE_LOCK.mul(amount)/s);   // this could shift to a future time, which require the lock before stake can be withdraw again
        }
        require(s <= MAX_S, "StakeLib: addition stake overflow");
        require(t <= MAX_T, "StakeLib: addition time overflow");
        return Stake(uint192(s), uint64(t));
    }

    function withdraw(Stake memory a, uint amount) internal view returns (Stake memory) {
        require(a.t < MAX_T, "StakeLib: !Stake");
        require(block.timestamp >= a.t, "StakeLib: locked");
        uint av = block.timestamp.sub(a.t).mul(a.s);
        uint s = a.s.sub(amount);
        if (s == 0) {
            require(av <= MAX_S, "StakeLib: unclaimed overflown");
            return Stake(uint192(av), uint64(MAX_T));
        }
        // the following subtraction throws when the remain total.s is too small
        uint t = block.timestamp.sub(av/s);
        require(t <= MAX_T, "StakeLib: addition time overflow");
        return Stake(uint192(s), uint64(t));
    }

    function harvest(Stake memory a, uint amount) internal view returns (Stake memory) {
        if (a.t == MAX_T) {
            a.s = uint192(a.s.sub(amount));
        } else {
            uint av = block.timestamp.sub(a.t).mul(a.s);
            uint t = block.timestamp.sub(av.sub(amount)/a.s);
            // TODO: assert(t <= MAX_T)
            a.t = uint64(t);
        }
        return a;
    }
}
