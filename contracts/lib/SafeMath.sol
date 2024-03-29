pragma solidity >=0.6.2;

// a library for performing overflow-safe math, courtesy of DappHub (https://github.com/dapphub/ds-math)

library SafeMath {
    function add(uint x, uint y) internal pure returns (uint z) {
        require((z = x + y) >= x, 'ds-math-add-overflow');
    }

    function sub(uint x, uint y) internal pure returns (uint z) {
        require((z = x - y) <= x, 'ds-math-sub-underflow');
    }

    function mul(uint x, uint y) internal pure returns (uint z) {
        require(y == 0 || (z = x * y) / y == x, 'ds-math-mul-overflow');
    }

    function add(uint x, uint y, string memory desc) internal pure returns (uint z) {
        require((z = x + y) >= x, desc);
    }

    function sub(uint x, uint y, string memory desc) internal pure returns (uint z) {
        require((z = x - y) <= x, desc);
    }

    function mul(uint x, uint y, string memory desc) internal pure returns (uint z) {
        require(y == 0 || (z = x * y) / y == x, desc);
    }
}
