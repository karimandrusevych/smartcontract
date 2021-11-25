# Legit.Art Smart Contracts

## Staging env

Network: goerli
Deployer wallet: `afraid deal credit expand coin hurry surge drift provide sweet type film`
USDC Facuted: [https://usdcfaucet.com/](https://usdcfaucet.com/)
Addresses:

- LegitArtRegistry: [0x9cD669E308A77529335b5279d3871765F1AfbDCb](https://goerli.etherscan.io/address/0x9cD669E308A77529335b5279d3871765F1AfbDCb)
- LegitArtERC721: [0x5EDD0DCD5D7566D73364237B19b3C32416f66738](https://goerli.etherscan.io/address/0x5EDD0DCD5D7566D73364237B19b3C32416f66738)
- MarketPlace: [0xc43d2E3727625E839FbFa5f2187bBEfa1F3beEF9](https://goerli.etherscan.io/address/0xc43d2E3727625E839FbFa5f2187bBEfa1F3beEF9)

## :floppy_disk: Installation

```bash
yarn
```

## :electric_plug: Setup

### Parameters

```bash
cp .env.example .env.<network>
code .env.<network>
```

Note: Where `<network>` is one of the networks configured in `hadhat.config.ts` (By default: `hardhat`, `mainnet` or `goerli`).

### Typechain

The `hardhat` will generates `typechain` code for contracts under `contracts/` folder. You can also have `typechain` code for external contracts (for instance, tests another DeFi protocols), you only need to put their ABIs inside of the `typechain/abi` and run `yarn compile`.

## :toolbox: Test

```bash
yarn compile
yarn test
```

Note: By default the tests will run against a forked Ethereum mainnet.

## :chains: Deploy & Verify

```bash
yarn <network>:deploy
yarn <network>:verify
```

Note: Etherscan API KEY is required for verification.
