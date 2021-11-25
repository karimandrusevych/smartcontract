import dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/types";
import { removeConsoleLog } from "hardhat-preprocessor";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import "@typechain/hardhat";
import "@nomiclabs/hardhat-waffle";
import "hardhat-spdx-license-identifier";
import "solidity-coverage";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-solhint";
import "hardhat-tracer";

dotenv.config();

const { REPORT_GAS, ETHERSCAN_API_KEY, ALCHEMY_API_KEY, DEPLOYER_MNEMONIC, COINMARKETCAP_API_KEY } = process.env;

const accounts = DEPLOYER_MNEMONIC ? { mnemonic: DEPLOYER_MNEMONIC } : undefined;

const config: HardhatUserConfig = {
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  preprocess: {
    eachLine: removeConsoleLog((bre) => bre.network.name !== "hardhat" && bre.network.name !== "localhost"),
  },
  solidity: {
    version: "0.8.4",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      forking: {
        url: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
        blockNumber: 13570900,
      },
    },
    // mainnet: {
    //   url: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
    //   accounts,
    // },
    goerli: {
      url: `https://eth-goerli.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
      accounts,
    },
  },
  spdxLicenseIdentifier: {
    overwrite: true,
    runOnCompile: true,
  },
  gasReporter: {
    enabled: REPORT_GAS == "true",
    currency: "USD",
    coinmarketcap: COINMARKETCAP_API_KEY,
    outputFile: "gas-report.txt",
    noColors: true,
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
};

export default config;
