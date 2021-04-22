const _ = require('lodash');

if (!String.prototype.pad) {
  Object.defineProperty(String.prototype, 'pad', {
    enumerable: false,
    value: function (n) {
      if (this.length >= n) {
        return this;
      }
      return '0'.repeat(n - this.length) + this;
    },
  });
}

if (!String.prototype.reverseHex) {
  Object.defineProperty(String.prototype, 'reverseHex', {
    enumerable: false,
    value: function() {
      const s = this.replace(/^(.(..)*)$/, "0$1");  // add a leading zero if needed
      const a = s.match(/../g);                     // split number in groups of two
      a.reverse();                                  // reverse the groups
      return a.join('');                            // join the groups back together
    },
  });
}

module.exports = {
  addressCompare(a, b) {
    if (!a) {
        return !b
    }
    return this.strip0x(a).localeCompare(this.strip0x(b), undefined, {sensitivity: 'accent'})
  },

  strip0x(a) {
    if (a && a.startsWith('0x')) {
        return a.substring(2)
    }
    return a
  },
}
