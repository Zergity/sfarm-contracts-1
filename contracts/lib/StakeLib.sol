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

    uint constant MAX_S = 2**192-1;
    uint constant MAX_T = 2**64-1;

    function value(Stake memory a) internal view returns (uint) {
        return a.t == MAX_T ? a.s : block.timestamp.sub(a.t).mul(a.s);
    }

    function deposit(Stake memory a, uint stake) internal view returns (Stake memory) {
        uint av; uint s;
        if (a.t == MAX_T) {
            av = a.s;
            s = stake;
        } else {
            av = block.timestamp.sub(a.t).mul(a.s);
            s = a.s.add(stake);
        }
        require(s <= MAX_S, "StakeLib: addition stake overflow");
        uint t = block.timestamp.sub(av/s);
        require(t <= MAX_T, "StakeLib: addition time overflow");
        return Stake(uint192(s), uint64(t));
    }

    function withdraw(Stake memory a, uint stake) internal view returns (Stake memory) {
        require(a.t < MAX_T, "StakeLib: !Stake");
        uint av = block.timestamp.sub(a.t).mul(a.s);
        uint s = a.s.sub(stake);
        if (s == 0) {
            require(av <= MAX_S, "StakeLib: unclaimed overflown");
            return Stake(uint192(av), uint64(MAX_T));
        }
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
