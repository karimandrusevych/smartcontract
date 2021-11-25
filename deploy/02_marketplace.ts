import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { MINTER_ROLE, Address } from "../helpers";
import { parseEther } from "@ethersproject/units";
import { ethers } from "ethers";

const LegitArtRegistry = "LegitArtRegistry";
const LegitArtERC721 = "LegitArtERC721";
const MarketPlace = "MarketPlace";

const { HARDHAT_NETWORK } = process.env;

const func: DeployFunction = async ({ getNamedAccounts, deployments }: HardhatRuntimeEnvironment) => {
  const { deploy, get, execute } = deployments;
  const { deployer } = await getNamedAccounts();

  const legitArtERC721 = await get(LegitArtERC721);

  const USDC_ADDRESS = HARDHAT_NETWORK === "goerli" ? Address.goerli.USDC : Address.mainnet.USDC;
  const FEE_BENEFICIARY_ADDRESS =
    HARDHAT_NETWORK === "goerli" ? Address.goerli.FEE_BENEFICIARY : Address.mainnet.FEE_BENEFICIARY;

  const primaryFeePercentage = parseEther("0.01"); // 1%
  const secondaryFeePercentage = parseEther("0.02"); // 2%
  const royaltyFeePercentage = parseEther("0.03"); // 3%

  const marketPlace = await deploy(MarketPlace, {
    from: deployer,
    args: [
      USDC_ADDRESS,
      legitArtERC721.address,
      FEE_BENEFICIARY_ADDRESS,
      primaryFeePercentage,
      secondaryFeePercentage,
      royaltyFeePercentage,
    ],
    log: true,
  });

  await execute(LegitArtERC721, { from: deployer, log: true }, "grantRole", MINTER_ROLE, marketPlace.address);
  await execute(LegitArtRegistry, { from: deployer, log: true }, "grantInitialAuthentication", marketPlace.address);
};

func.tags = [MarketPlace];
func.dependencies = [LegitArtRegistry, LegitArtERC721];

export default func;
