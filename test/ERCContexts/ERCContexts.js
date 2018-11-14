const ERC20Context = require("./contexts/ERC20Context.js");
const ERC677Context = require("./contexts/ERC677Context.js");

module.exports = {
    ERC20: {
        description: "ERC20 token",
        constructor: ERC20Context
    },
    ERC677: {
        description: "ERC677 token",
        constructor: ERC677Context
    }
}