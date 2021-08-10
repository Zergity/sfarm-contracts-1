const fs = require('fs')
const { ethers } = require('ethers');

const names = process.argv.slice(2);

const IGNORE_PREFIX = [
    'destruct(',
    'funcSelectors(',
    'initialize(',
]

const FUNCTION_REGEX = /    function funcSelectors\(\)(.|\n)*?    \}/gm

// Concatenate function name with its param types
const prepareData = e => `${e.name}(${e.inputs.map(e => e.type)})`

// Encode function selector (assume web3 is globally available)
const encodeSelector = f => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(f)).slice(0,10)

function searchFuncSelector(json, name) {
    const prop = 'functionSelector'
    for (var key in json) {
        var value = json[key];
        if (!value || typeof value !== 'object') {
            continue
        }
        if (value.hasOwnProperty(prop) && value.kind === 'function' && name.startsWith(value.name)) {
            return value[prop]
        }
        const found = searchFuncSelector(value, name);
        if (found) {
            return found
        }
    }
}

function getFuncs(name) {
    const json = require(`../build/contracts/${name}.json`)
    const ABI = json.abi || json
    return ABI.filter(e => e.type === "function").map(prepareData)
}

const proxyFuncs = getFuncs('Proxy')

function getFuncSelectors(name) {
    const json = require(`../build/contracts/${name}.json`)
    const funcs = getFuncs(name)
        .filter(f => !IGNORE_PREFIX.some(p => f.startsWith(p)))
        .filter(f => !proxyFuncs.includes(f))

    const map = {}
    funcs.forEach(func => {
        if (func.includes('tuple')) {
            map['0x'+searchFuncSelector(json, func)] = func
        } else {
            map[encodeSelector(func)] = func
        }
    })

    return map
}

names.forEach(name => {
    const solfile = `./contracts/${name}.sol` 

    fs.readFile(solfile, 'utf8', (err, data) => {
        if (err) {
            return console.log(err);
        }
        // console.error({data})
    
        const funcs = getFuncSelectors(name)
        
        // console.error({funcs})

        // Parse ABI and encode its functions
        const output = Object.entries(funcs)
            .map((e, i) => `signs[${i}] = ${e[0]};\t\t// ${e[1]}`)
            .join(`\n        `)
            .trim()

        // console.log(output)

        const funcText = `    function funcSelectors() external view override returns (bytes4[] memory signs) {
        signs = new bytes4[](${Object.keys(funcs).length});
        ${output}
    }`

        const result = data.replace(FUNCTION_REGEX, funcText);
        // console.error(result)
    
        fs.writeFile(solfile, result, 'utf8', function (err) {
            if (err) return console.log(err);
            console.log('generated:', name)
            console.log(funcs)
        });
    })
})
